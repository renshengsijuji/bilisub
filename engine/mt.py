"""翻译提供者：mock / OPUS-MT(CT2) / NLLB(CT2) / OpenAI 兼容 API"""
import json
import os
import urllib.request


class MTError(Exception):
    pass


class MockMT:
    """无模型时用于跑通链路：返回带标记的文本"""
    name = "mock"

    def translate(self, texts, src="en", tgt="zh"):
        return ["〔译〕" + t for t in texts]


class OpusMT:
    """Marian / OPUS-MT 的 CTranslate2 版本（英→中）"""
    name = "opus-mt"
    LANGS = {"en"}

    def __init__(self, model_dir: str):
        import ctranslate2
        import sentencepiece as spm

        threads = max(1, (os.cpu_count() or 4) // 2)
        self._tr = ctranslate2.Translator(
            model_dir, device="cpu", compute_type="int8",
            inter_threads=1, intra_threads=threads,
        )
        self._src = spm.SentencePieceProcessor(model_file=os.path.join(model_dir, "source.spm"))
        self._tgt = spm.SentencePieceProcessor(model_file=os.path.join(model_dir, "target.spm"))

    def translate(self, texts, src="en", tgt="zh"):
        if src not in self.LANGS:
            raise MTError("OPUS 模型只支持英→中，其他语言请切换到 NLLB 或 Ollama")
        # CTranslate2 4.x 输入是字符串 token；Marian 要求源端以 </s> 结尾，否则会复读
        batch = [self._src.encode(t, out_type=str) + ["</s>"] for t in texts]
        results = self._tr.translate_batch(batch, beam_size=4, max_batch_size=16)
        out = []
        for r in results:
            text = self._tgt.decode(r.hypotheses[0])
            out.append(text.replace("</s>", "").replace("<pad>", "").strip())
        return out


class NllbMT:
    """NLLB-200 的 CTranslate2 版本（200 语言）"""
    name = "nllb"

    LANGS = {
        "en": "eng_Latn", "zh": "zho_Hans", "zh-tw": "zho_Hant",
        "fr": "fra_Latn", "de": "deu_Latn", "ru": "rus_Cyrl",
        "ja": "jpn_Jpan", "ko": "kor_Hang", "es": "spa_Latn",
        "it": "ita_Latn", "pt": "por_Latn", "ar": "arb_Arab",
    }

    def __init__(self, model_dir: str):
        import ctranslate2
        from tokenizers import Tokenizer

        threads = max(1, (os.cpu_count() or 4) // 2)
        self._tr = ctranslate2.Translator(
            model_dir, device="cpu", compute_type="int8",
            inter_threads=1, intra_threads=threads,
        )
        self._tok = Tokenizer.from_file(os.path.join(model_dir, "tokenizer.json"))

    def _lang_id(self, code: str) -> int:
        token = self.LANGS.get(code, code)
        tid = self._tok.token_to_id(token)
        if tid is None:
            raise MTError("NLLB 不支持的语言: " + code)
        return tid

    def translate(self, texts, src="en", tgt="zh"):
        src_token = self.LANGS.get(src, src)
        tgt_token = self.LANGS.get(tgt, tgt)
        if self._tok.token_to_id(src_token) is None or self._tok.token_to_id(tgt_token) is None:
            raise MTError("NLLB 不支持的语言: %s -> %s" % (src, tgt))

        # 4.x 要求字符串 token；源语言作为第一个 token，目标语言作为 target_prefix
        batch = [[src_token] + self._tok.encode(t).tokens + ["</s>"] for t in texts]
        results = self._tr.translate_batch(
            batch, target_prefix=[[tgt_token]] * len(batch),
            beam_size=4, max_batch_size=16,
        )
        out = []
        for r in results:
            ids = [self._tok.token_to_id(t) for t in r.hypotheses[0]]
            ids = [i for i in ids if i is not None]
            out.append(self._tok.decode(ids, skip_special_tokens=True).strip())
        return out


class OpenAIMT:
    """任意 OpenAI 兼容端点（可填本地 Ollama/LM Studio 的 /v1）"""
    name = "openai"

    def __init__(self, cfg: dict):
        self.base = str(cfg.get("base_url", "https://api.openai.com/v1")).rstrip("/")
        self.key = cfg.get("api_key", "")
        self.model = cfg.get("model", "gpt-4o-mini")
        # 仅 Ollama 有意义：让模型常驻显存，避免闲置后重载（重载可能 10~20 秒）
        self.keep_alive = cfg.get("keep_alive")

    def translate(self, texts, src="en", tgt="zh"):
        numbered = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(texts))
        prompt = (
            "你是专业的字幕翻译。把下面每一行翻译成简体中文。\n"
            "要求：逐行对应、只输出译文、不要编号、不要解释、不合并行、保留人名专有名词。\n\n"
            + numbered
        )
        payload = {
            "model": self.model,
            "temperature": 0,
            "messages": [
                {"role": "system", "content": "你只输出翻译结果，不输出任何解释。"},
                {"role": "user", "content": prompt},
            ],
        }
        if self.keep_alive:
            payload["keep_alive"] = self.keep_alive
        req = urllib.request.Request(
            self.base + "/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer " + self.key,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                data = json.loads(res.read().decode("utf-8"))
            text = data["choices"][0]["message"]["content"]
        except Exception as exc:
            raise MTError("API 请求失败: " + str(exc))

        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        lines = [ln.split(". ", 1)[1] if ln[:2].strip().rstrip(".").isdigit() and ". " in ln else ln for ln in lines]
        if len(lines) != len(texts):
            # 行数对不上时退化为逐条翻译，避免错位
            return [self._one(t) for t in texts]
        return lines

    def _one(self, text):
        payload = {
            "model": self.model,
            "temperature": 0,
            "messages": [
                {"role": "system", "content": "只输出简体中文译文，不要解释。"},
                {"role": "user", "content": text},
            ],
        }
        if self.keep_alive:
            payload["keep_alive"] = self.keep_alive
        req = urllib.request.Request(
            self.base + "/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "Authorization": "Bearer " + self.key},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as res:
            data = json.loads(res.read().decode("utf-8"))
        return data["choices"][0]["message"]["content"].strip()


def build_mt(cfg: dict, models):
    """按配置创建翻译器
    provider: local（CT2 模型） / ollama（本地 GPU） / openai（自定义 API） / mock
    """
    provider = cfg.get("provider", "mock")
    if provider == "mock":
        return MockMT()

    if provider == "ollama":
        base = str(cfg.get("base_url") or "http://127.0.0.1:11434").rstrip("/")
        if not base.endswith("/v1"):
            base += "/v1"
        return OpenAIMT({
            "base_url": base,
            "api_key": cfg.get("api_key") or "ollama",
            "model": cfg.get("model") or "qwen2.5:7b",
            "keep_alive": cfg.get("keep_alive") or "24h",
        })

    if provider == "openai":
        return OpenAIMT(cfg)

    model_id = cfg.get("model") or "mt-opus-en-zh"
    if not models.is_installed(model_id):
        raise MTError(f"模型未安装: {model_id}")
    model_dir = models.path(model_id)
    if model_id.startswith("mt-opus"):
        return OpusMT(model_dir)
    return NllbMT(model_dir)
