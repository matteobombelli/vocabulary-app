"""Message Batches plumbing: build requests, estimate cost, submit, collect, record usage.

Each stage keeps its state in data/<lang>/enrich/<stage>/:
  batches.json   every batch submitted for the stage, with custom_id → ranks
  results.jsonl  one parsed entry per word (latest wins), tagged with the model
  usage.jsonl    token usage per succeeded request, for actual cost and future estimates
"""

import json
import sys
import time
from pathlib import Path

import anthropic
from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
from anthropic.types.messages.batch_create_params import Request

from .paths import lang_dir
from .words import read_lemmas

# Batch prices (50% of list), USD per million tokens, for prompts under Haiku's 100K boundary.
PRICE = {
    "claude-haiku-5-5": {"in": 0.05, "out": 0.25},
    "claude-sonnet-5-5": {"in": 1.00, "out": 5.00},
}
# Output tokens per word (thinking included), used until a collected stage gives a measured value.
DEFAULT_OUT_PER_WORD = {("en", "gen"): 260, ("fr", "gen"): 480, ("en", "repair"): 120,
                        ("en", "games"): 350, ("fr", "games"): 450}
MAX_TOKENS = 48000


def stage_dir(lang: str, stage: str) -> Path:
    d = lang_dir(lang) / "enrich" / stage
    d.mkdir(parents=True, exist_ok=True)
    return d


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.open(encoding="utf-8")] if path.exists() else []


def append_jsonl(path: Path, rows: list[dict]) -> None:
    with path.open("a", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def load_batches(lang: str, stage: str) -> list[dict]:
    p = stage_dir(lang, stage) / "batches.json"
    return json.loads(p.read_text()) if p.exists() else []


def save_batches(lang: str, stage: str, batches: list[dict]) -> None:
    (stage_dir(lang, stage) / "batches.json").write_text(json.dumps(batches, indent=1) + "\n")


def load_results(lang: str, stage: str) -> dict[int, dict]:
    """rank → latest result. Results are matched by lemma and re-ranked against the current list,
    so a rebuilt list keeps every entry whose word is still in it and drops the rest."""
    rank_of = {w["lemma"]: w["rank"] for w in read_lemmas(lang)}
    out = {}
    for r in read_jsonl(stage_dir(lang, stage) / "results.jsonl"):
        rank = rank_of.get(r.get("lemma"))
        if rank is not None:
            out[rank] = {**r, "rank": rank}
    return out


def params(model: str, effort: str, system: str, user: str, schema: dict) -> MessageCreateParamsNonStreaming:
    return MessageCreateParamsNonStreaming(
        model=model,
        max_tokens=MAX_TOKENS,
        system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": user}],
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
    )


def measured_out_per_word(lang: str, kind: str, model: str) -> float | None:
    """Mean output tokens per word over every collected stage of this kind and model."""
    words = toks = 0
    for d in (lang_dir(lang) / "enrich").glob("*/usage.jsonl"):
        for u in read_jsonl(d):
            if u["kind"] == kind and u["model"] == model:
                words += u["words"]
                toks += u["output_tokens"]
    return toks / words if words else None


def estimate(client: anthropic.Anthropic, lang: str, kind: str, model: str,
             chunks: list[tuple[str, list[int], MessageCreateParamsNonStreaming]]) -> dict:
    """Input tokens: count_tokens on the largest request, scaled by prompt length. Output tokens:
    measured per-word mean if a stage has been collected, else the default guess."""
    n_words = sum(len(r) for _, r, _ in chunks)
    sample = max(chunks, key=lambda c: len(c[2]["messages"][0]["content"]))[2]
    chars = lambda p: len(p["system"][0]["text"]) + len(p["messages"][0]["content"])
    in_per_char = None
    try:
        counted = client.messages.count_tokens(
            model=model, system=sample["system"], messages=sample["messages"], output_config=sample["output_config"])
        in_per_char = counted.input_tokens / chars(sample)
    except (TypeError, anthropic.AuthenticationError) as e:  # no credential yet: count characters
        print(f"(count_tokens unavailable: {e.__class__.__name__}; estimating input from characters)")
    in_tokens = sum(chars(p) for _, _, p in chunks) * (in_per_char or 1 / 3.2)
    measured = measured_out_per_word(lang, kind, model)
    out_per_word = measured or DEFAULT_OUT_PER_WORD[(lang, kind)]
    out_tokens = n_words * out_per_word
    price = PRICE[model]
    cost = in_tokens / 1e6 * price["in"] + out_tokens / 1e6 * price["out"]
    return {
        "requests": len(chunks), "words": n_words, "model": model,
        "input_tokens": round(in_tokens), "output_tokens": round(out_tokens),
        "out_per_word": round(out_per_word), "out_source": "measured" if measured else "default guess",
        "input_source": "count_tokens" if in_per_char else "chars/3.2",
        "usd": round(cost, 2),
    }


def print_estimate(est: dict, stage: str, lang: str) -> None:
    print(f"\n[{lang}/{stage}] {est['requests']} requests, {est['words']:,} words on {est['model']} (batch prices)")
    print(f"  input  ≈ {est['input_tokens']:>12,} tokens ({est['input_source']})")
    print(f"  output ≈ {est['output_tokens']:>12,} tokens ({est['out_per_word']}/word, {est['out_source']})")
    print(f"  estimated cost ≈ ${est['usd']:.2f}  (budget for up to ${est['usd'] * 1.5:.2f})\n")


def submit(client: anthropic.Anthropic, lang: str, stage: str, kind: str,
           chunks: list[tuple[str, list[int], MessageCreateParamsNonStreaming]]) -> str:
    batch = client.messages.batches.create(requests=[Request(custom_id=cid, params=p) for cid, _, p in chunks])
    batches = load_batches(lang, stage)
    batches.append({
        "id": batch.id, "kind": kind, "model": chunks[0][2]["model"], "submitted_at": int(time.time()),
        "requests": {cid: ranks for cid, ranks, _ in chunks}, "collected": False,
    })
    save_batches(lang, stage, batches)
    print(f"[{lang}/{stage}] submitted batch {batch.id} ({len(chunks)} requests)")
    return batch.id


def collect(client: anthropic.Anthropic, lang: str, stage: str, parse_entry, wait: bool) -> bool:
    """Download every ended, uncollected batch of the stage. parse_entry(entry, model) returns the
    stored row or None if the entry fails validation. Returns True when nothing is left in flight."""
    batches = load_batches(lang, stage)
    d = stage_dir(lang, stage)
    lemma_of = {w["rank"]: w["lemma"] for w in read_lemmas(lang)}
    pending = [b for b in batches if not b["collected"]]
    while pending:
        for b in pending:
            info = client.messages.batches.retrieve(b["id"])
            if info.processing_status != "ended":
                c = info.request_counts
                print(f"[{lang}/{stage}] {b['id']}: {info.processing_status}, "
                      f"{c.succeeded} done, {c.processing} processing, {c.errored} errored")
                continue
            for attempt in range(3):
                try:  # results stream can drop mid-download; nothing is written until it completes
                    results = list(client.messages.batches.results(b["id"]))
                    break
                except Exception as e:
                    if attempt == 2:
                        raise
                    print(f"[{lang}/{stage}] {b['id']}: download failed ({e.__class__.__name__}), retrying")
                    time.sleep(10)
            rows, usage, failed = [], [], {}
            for res in results:
                ranks = b["requests"][res.custom_id]
                if res.result.type != "succeeded":
                    failed[res.custom_id] = res.result.type
                    continue
                msg = res.result.message
                if msg.stop_reason != "end_turn":
                    failed[res.custom_id] = msg.stop_reason
                    continue
                text = next((blk.text for blk in msg.content if blk.type == "text"), "")
                try:
                    entries = json.loads(text)["words"]
                except (json.JSONDecodeError, KeyError):
                    failed[res.custom_id] = "bad json"
                    continue
                wanted = set(ranks)
                for e in entries:
                    if e.get("rank") in wanted:
                        row = parse_entry(e, msg.model)
                        if row is not None:
                            row["lemma"] = lemma_of[e["rank"]]
                            rows.append(row)
                            wanted.discard(e["rank"])
                if wanted:
                    failed[res.custom_id] = f"{len(wanted)} words missing or invalid"
                usage.append({
                    "batch": b["id"], "custom_id": res.custom_id, "kind": b["kind"], "model": b["model"],
                    "words": len(ranks), "input_tokens": msg.usage.input_tokens,
                    "cache_read_input_tokens": msg.usage.cache_read_input_tokens or 0,
                    "cache_creation_input_tokens": msg.usage.cache_creation_input_tokens or 0,
                    "output_tokens": msg.usage.output_tokens,
                })
            append_jsonl(d / "results.jsonl", rows)
            append_jsonl(d / "usage.jsonl", usage)
            b["collected"] = True
            b["failed"] = failed
            save_batches(lang, stage, batches)
            print(f"[{lang}/{stage}] collected {b['id']}: {len(rows)} words, {len(failed)} failed requests")
            for cid, why in list(failed.items())[:10]:
                print(f"    {cid}: {why}")
        pending = [b for b in batches if not b["collected"]]
        if not pending or not wait:
            break
        time.sleep(60)
    return not pending


def reparse_failed(client: anthropic.Anthropic, lang: str, stage: str, parse_entry) -> None:
    """Parse the failed requests of collected batches again (after a parser fix), from the results
    already paid for. Usage is not recorded twice."""
    batches = load_batches(lang, stage)
    d = stage_dir(lang, stage)
    lemma_of = {w["rank"]: w["lemma"] for w in read_lemmas(lang)}
    done = {r["rank"] for r in read_jsonl(d / "results.jsonl")}
    for b in batches:
        failed = b.get("failed") or {}
        if not b["collected"] or not failed:
            continue
        rows, still, seen = [], {}, set()
        for res in client.messages.batches.results(b["id"]):
            if res.custom_id not in failed or res.result.type != "succeeded":
                continue
            seen.add(res.custom_id)
            msg = res.result.message
            text = next((blk.text for blk in msg.content if blk.type == "text"), "")
            try:
                entries = json.loads(text)["words"]
            except (json.JSONDecodeError, KeyError):
                still[res.custom_id] = failed[res.custom_id]
                continue
            wanted = set(b["requests"][res.custom_id]) - done
            for e in entries:
                if e.get("rank") in wanted:
                    row = parse_entry(e, msg.model)
                    if row is not None:
                        row["lemma"] = lemma_of[e["rank"]]
                        rows.append(row)
                        wanted.discard(e["rank"])
            if wanted:
                still[res.custom_id] = f"{len(wanted)} words missing or invalid"
        append_jsonl(d / "results.jsonl", rows)
        # Requests not re-parsed here (errored, expired) stay failed too.
        b["failed"] = {cid: why for cid, why in failed.items() if cid in still or cid not in seen}
        save_batches(lang, stage, batches)
        print(f"[{lang}/{stage}] re-parsed {b['id']}: recovered {len(rows)} words, {len(b['failed'])} requests still failing")


def actual_cost(lang: str, stage: str) -> dict:
    u = read_jsonl(stage_dir(lang, stage) / "usage.jsonl")
    usd = 0.0
    for r in u:
        p = PRICE[r["model"]]
        # Cache reads bill at 0.1x and 5-minute writes at 1.25x the input rate.
        inp = r["input_tokens"] + 0.1 * r["cache_read_input_tokens"] + 1.25 * r["cache_creation_input_tokens"]
        usd += inp / 1e6 * p["in"] + r["output_tokens"] / 1e6 * p["out"]
    words = sum(r["words"] for r in u)
    out = sum(r["output_tokens"] for r in u)
    return {"requests": len(u), "words": words, "output_tokens": out,
            "out_per_word": round(out / words) if words else 0, "usd": round(usd, 4)}


def confirm(est: dict, assume_yes: bool) -> bool:
    if assume_yes:
        return True
    if not sys.stdin.isatty():
        print("Not submitted: pass --confirm after the estimate is approved.")
        return False
    return input(f"Submit for ≈ ${est['usd']:.2f}? [y/N] ").strip().lower() == "y"
