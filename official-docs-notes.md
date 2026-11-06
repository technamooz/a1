# یافته‌های مستندات رسمی برای Technamooz AI v2.0.0

- OpenRouter Quickstart: https://openrouter.ai/docs/quickstart
  - API سازگار با OpenAI؛ endpoint چت `https://openrouter.ai/api/v1/chat/completions` و فهرست مدل `GET https://openrouter.ai/api/v1/models`.
- OpenRouter FAQ: https://openrouter.ai/docs/faq
  - احراز هویت API با Bearer token است؛ مدل‌های رایگان variant `:free` دارند و `openrouter/free` روتر مدل رایگان است؛ streaming با `stream: true` انجام می‌شود.
- OrcaRouter introduction: https://docs.orcarouter.ai/introduction
  - base URL رسمی `https://api.orcarouter.ai/v1` و API سازگار با OpenAI اعلام شده است.
- OrcaRouter free models: https://docs.orcarouter.ai/routing/free-models
  - مدل‌های رایگان با suffix `-free` و pricing request صفر مشخص می‌شوند؛ `orcarouter/free` روتر داخلی رایگان است؛ سقف‌های رایگان به‌صورت زنده و tiered هستند و prompt cap عدد ثابتی ندارد.
- OneRouter/Infron docs: https://infron.ai/docs
  - صفحهٔ رسمی Infron وجود دارد، اما در متن استخراج‌شده endpoint سازگار با OpenAI، مسیر `/models` یا رایگان‌بودن OneRouter تأیید نشده است.
- Cloudflare Workers AI OpenAI compatibility: https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/
  - endpoint REST چت `/v1/chat/completions` زیر مسیر account AI و احراز هویت Bearer؛ برای binding داخلی باید از `env.AI.run()` استفاده شود.
- Cloudflare Static Assets binding: https://developers.cloudflare.com/workers/static-assets/binding/
  - `assets.directory`, optional `binding`, و `run_worker_first = true` برای عبور API از Worker معتبر است.

نتیجهٔ اجرایی: OpenRouter و OrcaRouter با adapter OpenAI-compatible قابل استفاده‌اند؛ OneRouter فعلاً فقط به‌عنوان provider اختیاری/قابل تنظیم نگه داشته می‌شود و رایگان‌بودن و endpoint رسمی آن تأیید نشده است.
