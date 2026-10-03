"""Owned, scale-to-zero LLM endpoint on Modal — the last-resort floor of the
app's provider chain (parse-resume and, later, the auto-apply drafter).

WHY: hosted free tiers (NVIDIA NIM, Cloudflare, Groq, …) handle ~everything, but
any of them can rate-limit or change terms. This is a model WE own that only runs
when all of those are down. Because Modal is scale-to-zero, it sits idle at $0 and
only bills the rare GPU-seconds it actually serves — comfortably inside Modal's
free $30/mo credit, which needs no credit card.

WHAT: runs vLLM's OpenAI-compatible server for a small, strong extraction model
(Qwen2.5-7B-Instruct, AWQ 4-bit, ~6GB) on an L4. Weights are baked into the image
at build time so a cold start is ~20-30s (not minutes). Requests require a bearer
token (a Modal Secret) so only our app can call it. No training on inputs — it's
our box, so it's PII-safe for resumes.

DEPLOY (one-time, needs a free Modal account — no card):
    pip install modal
    modal token new                      # browser login
    modal secret create resume-llm-secret LLM_API_KEY=<make-a-long-random-string>
    modal deploy infra/modal/resume_llm.py

Modal prints a public URL like  https://<you>--resume-llm-serve.modal.run
Then set these in the app env (Vercel) + scraper/.env:
    MODAL_LLM_URL=https://<you>--resume-llm-serve.modal.run/v1/chat/completions
    MODAL_LLM_SECRET=<the same long random string>
    MODAL_LLM_MODEL=Qwen/Qwen2.5-7B-Instruct-AWQ

The chain in src/app/api/parse-resume/route.ts already reads those three vars and
calls this endpoint last.
"""
from __future__ import annotations

import modal

MODEL_NAME = "Qwen/Qwen2.5-7B-Instruct-AWQ"  # ~6GB 4-bit; must match MODAL_LLM_MODEL
MODEL_REVISION = "main"
VLLM_PORT = 8000


def _download_model() -> None:
    """Bake the weights into the image at build time so cold starts don't
    re-download from HuggingFace (cuts cold start from minutes to ~20-30s)."""
    from huggingface_hub import snapshot_download
    snapshot_download(MODEL_NAME, revision=MODEL_REVISION,
                      ignore_patterns=["*.pt", "*.bin"])  # prefer safetensors


image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "vllm>=0.6.6",
        "huggingface_hub[hf_transfer]",
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
    .run_function(_download_model)  # weights baked into the image layer
)

app = modal.App("resume-llm")


@app.function(
    image=image,
    gpu="L4",                 # 24GB, cheapest that holds a 7B comfortably ($0.80/hr)
    min_containers=0,         # scale to zero → idle costs $0 (this is the point)
    scaledown_window=60,      # stay warm 60s after a request to catch bursts
    timeout=600,
    secrets=[modal.Secret.from_name("resume-llm-secret")],
)
@modal.web_server(port=VLLM_PORT, startup_timeout=600)
def serve() -> None:
    """Launch vLLM's OpenAI-compatible server. --api-key makes every request
    require `Authorization: Bearer <LLM_API_KEY>`, so only our app can use it."""
    import os
    import subprocess

    subprocess.Popen([
        "python", "-m", "vllm.entrypoints.openai.api_server",
        "--model", MODEL_NAME,
        "--revision", MODEL_REVISION,
        "--port", str(VLLM_PORT),
        "--api-key", os.environ["LLM_API_KEY"],
        "--max-model-len", "8192",       # resume text + JSON output fits easily
        "--gpu-memory-utilization", "0.90",
        "--disable-log-requests",        # don't log prompts (PII hygiene)
    ])
