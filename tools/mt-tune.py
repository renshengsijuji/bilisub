# -*- coding: utf-8 -*-
"""调参：源端是否加 </s>、beam、重复惩罚对 OPUS-MT 输出的影响"""
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")

import ctranslate2
import sentencepiece as spm

MODEL = r"E:\Deepseek\bili-sub\models\mt-opus-en-zh"
tr = ctranslate2.Translator(MODEL, device="cpu", compute_type="int8", intra_threads=4)
src = spm.SentencePieceProcessor(model_file=os.path.join(MODEL, "source.spm"))
tgt = spm.SentencePieceProcessor(model_file=os.path.join(MODEL, "target.spm"))

sentences = [
    "Hello everyone, welcome back to the channel.",
    "Today we are going to talk about how computers understand human language.",
    "That's all for today, thanks for watching.",
]

variants = [
    ("greedy, no eos", dict(beam_size=1), False),
    ("greedy, eos", dict(beam_size=1), True),
    ("beam4, no eos", dict(beam_size=4), False),
    ("beam4, eos", dict(beam_size=4), True),
    ("beam4, eos, rep1.3", dict(beam_size=4, repetition_penalty=1.3), True),
    ("beam4, eos, ngram3", dict(beam_size=4, no_repeat_ngram_size=3), True),
]

for name, kwargs, add_eos in variants:
    batch = []
    for s in sentences:
        toks = src.encode(s, out_type=str)
        if add_eos:
            toks = toks + ["</s>"]
        batch.append(toks)
    results = tr.translate_batch(batch, **kwargs)
    print("\n===", name, "===")
    for s, r in zip(sentences, results):
        text = tgt.decode(r.hypotheses[0]).replace("</s>", "").strip()
        print("  ", text)
