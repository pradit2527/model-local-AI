"""QLoRA fine-tune of UnfilteredAI/DAN-L3-R1-8B with Unsloth (runs ON A01, RTX 4060 Ti 8 GB).

D:\\ai-midel\\train\\.venv\\Scripts\\python.exe D:\\ai-midel\\train.py [--merge-only]
  -> LoRA adapter  D:\\ai-midel\\train\\lora
  -> merged bf16   D:\\ai-midel\\train\\merged   (imported into Ollama with quantization afterwards)
Checkpoints every 100 steps in train\\out; re-running resumes from the latest one.
"""
import os
import sys
from pathlib import Path

ROOT = Path(os.environ.get("AI_ROOT", r"D:\ai-midel"))   # /mnt/d/ai-midel when run inside WSL
BASE = str(ROOT / "base" / "DAN-L3-R1-8B")
DATA = str(ROOT / "train" / "data" / "mix.jsonl")
OUT = ROOT / "train"
MAX_LEN = 2048

# Must render exactly like the TEMPLATE in Modelfile.plus (ChatML + Qwen2.5/Hermes-style tools) so Ollama
# can parse <tool_call> output and MCP tools work.
TOOLS_HEAD = ("\n\n# Tools\n\nYou may call one or more functions to assist with the user query.\n\n"
              "You are provided with function signatures within <tools></tools> XML tags:\n<tools>")
TOOLS_TAIL = ("\n</tools>\n\nFor each function call, return a json object with function name and arguments within "
              "<tool_call></tool_call> XML tags:\n<tool_call>\n{\"name\": <function-name>, \"arguments\": "
              "<args-json-object>}\n</tool_call>")


def render(messages, tools=None):
    import json
    tools = json.loads(tools) if isinstance(tools, str) and tools else tools
    out, system = [], ""
    if messages and messages[0]["role"] == "system":
        system, messages = messages[0]["content"], messages[1:]
    if system or tools:
        s = "<|im_start|>system" + ("\n" + system if system else "")
        if tools:
            s += TOOLS_HEAD + "".join("\n" + json.dumps({"type": "function", "function": t}, ensure_ascii=False)
                                      for t in tools) + TOOLS_TAIL
        out.append(s + "<|im_end|>\n")
    for m in messages:
        c = m["content"]
        if m["role"] == "tool":
            c = c if c.lstrip().startswith("<tool_response>") else f"<tool_response>\n{c}\n</tool_response>"
            out.append(f"<|im_start|>user\n{c}<|im_end|>\n")
        else:
            out.append(f"<|im_start|>{m['role']}\n{c}<|im_end|>\n")
    return "".join(out)


def main():
    from unsloth import FastLanguageModel
    from unsloth.chat_templates import train_on_responses_only
    from datasets import load_dataset
    from trl import SFTConfig, SFTTrainer

    model, tok = FastLanguageModel.from_pretrained(BASE, max_seq_length=MAX_LEN, load_in_4bit=True, dtype=None)

    if "--merge-only" not in sys.argv:
        model = FastLanguageModel.get_peft_model(
            model, r=16, lora_alpha=16, lora_dropout=0, bias="none",   # round 2: alpha 32 -> 16
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
            use_gradient_checkpointing="unsloth", random_state=42,
        )
        ds = load_dataset("json", data_files=DATA, split="train")
        has_tools = "tools" in ds.column_names
        ds = ds.map(lambda b: {"text": [render(m, (b["tools"][i] if has_tools else None))
                                        for i, m in enumerate(b["messages"])]},
                    batched=True, remove_columns=ds.column_names)
        import inspect
        cfg = dict(
            dataset_text_field="text", dataset_num_proc=1, packing=False,
            per_device_train_batch_size=1, gradient_accumulation_steps=16, num_train_epochs=1,
            learning_rate=5e-5, lr_scheduler_type="cosine", warmup_ratio=0.03, weight_decay=0.01,
            optim="adamw_8bit", bf16=True, logging_steps=10, save_steps=100, save_total_limit=2,
            output_dir=str(OUT / "out"), report_to="none", seed=42,
        )
        # TRL renamed max_seq_length -> max_length and tokenizer -> processing_class; support both
        cfg_params = inspect.signature(SFTConfig.__init__).parameters
        cfg["max_length" if "max_length" in cfg_params else "max_seq_length"] = MAX_LEN
        tr_params = inspect.signature(SFTTrainer.__init__).parameters
        tok_arg = {"processing_class": tok} if "processing_class" in tr_params else {"tokenizer": tok}
        trainer = SFTTrainer(model=model, train_dataset=ds, args=SFTConfig(**cfg), **tok_arg)
        # learn only the answers, not the prompts
        trainer = train_on_responses_only(trainer, instruction_part="<|im_start|>user\n",
                                          response_part="<|im_start|>assistant\n")
        resume = any((OUT / "out").glob("checkpoint-*"))
        trainer.train(resume_from_checkpoint=resume or None)
        model.save_pretrained(str(OUT / "lora"))
        tok.save_pretrained(str(OUT / "lora"))
    else:
        from peft import PeftModel
        model = PeftModel.from_pretrained(model, str(OUT / "lora"))

    model.save_pretrained_merged(str(OUT / "merged"), tok, save_method="merged_16bit")
    print("TRAIN DONE", flush=True)


if __name__ == "__main__":
    main()
