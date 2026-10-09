"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DECKS, type DeckId } from "@/features/cards/deck";
import { fetchAiStatus } from "@/features/reading/client";
import { saveSettings, useSettings } from "./settings";

export function SettingsPanel() {
  const settings = useSettings();
  const [ai, setAi] = useState<boolean | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAiStatus().then((ok) => !cancelled && setAi(ok));
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (patch: Partial<typeof settings>) => setSaveFailed(!saveSettings({ ...settings, ...patch }));
  const decks = Object.entries(DECKS) as [DeckId, (typeof DECKS)[DeckId]][];

  return (
    <div className="divide-y divide-line [&>section]:py-7 [&>section:first-child]:pt-0">
      {saveFailed && (
        <p role="alert" className="hairline pt-3 text-sm">
          这个浏览器没有允许保存设置，这次设置只在当前页面有效。
        </p>
      )}

      <section aria-labelledby="reversed-title" className="space-y-2">
        <h2 id="reversed-title" className="font-serif text-xl">
          逆位牌
        </h2>
        <label className="flex min-h-11 items-start gap-3 text-sm leading-relaxed">
          <input type="checkbox" checked={settings.allowReversed} onChange={(e) => update({ allowReversed: e.target.checked })} className="mt-0.5 h-6 w-6 shrink-0" />
          <span>
            抽牌时可能出现逆位
            <span className="block text-xs text-muted">只影响下一次抽牌。已经保存的记录按当时的设置显示，不会被改动。</span>
          </span>
        </label>
      </section>

      <section aria-labelledby="deck-title" className="space-y-2">
        <h2 id="deck-title" className="font-serif text-xl">
          牌组
        </h2>
        <fieldset className="space-y-2">
          <legend className="sr-only">牌组</legend>
          {decks.map(([id, deck]) => (
            <label key={id} className="flex min-h-11 items-center gap-3 text-sm">
              <input type="radio" name="deck" checked={settings.deckId === id} onChange={() => update({ deckId: id })} className="h-6 w-6 shrink-0" />
              {deck.name}
            </label>
          ))}
        </fieldset>
        <p className="text-xs text-muted">{decks.length === 1 ? "目前只有一套牌组，新增牌组后会出现在这里。" : "只影响下一次抽牌；历史记录按保存时的牌组显示。"}</p>
      </section>

      <section aria-labelledby="ai-title" className="space-y-2">
        <h2 id="ai-title" className="font-serif text-xl">
          AI 解读
        </h2>
        <p className="text-sm leading-relaxed" data-testid="ai-status">
          {ai === null && "正在检查…"}
          {ai === true && "本机服务已配置模型 API key，可以选择“AI 辅助”。"}
          {ai === false && "本机服务没有配置 API key，只能使用本地解读。想开启 AI，见 README 的“路线二”。"}
        </p>
        <p className="text-xs text-muted">这里只显示是否已配置，不显示也不保存 key。key 只写在你电脑上的 .env.local 里。</p>
      </section>

      <section aria-labelledby="data-title" className="space-y-2">
        <h2 id="data-title" className="font-serif text-xl">
          数据
        </h2>
        <p className="text-sm leading-relaxed">
          记录只保存在这个浏览器里。备份、导入和清空都在{" "}
          <Link href="/history" className="text-accent underline underline-offset-4">
            历史
          </Link>
          页。设置本身不会进入备份，也不会被导入覆盖。
        </p>
      </section>
    </div>
  );
}
