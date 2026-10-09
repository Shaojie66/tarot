"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DECKS, type DeckId } from "@/features/cards/deck";
import { fetchAiStatus } from "@/features/reading/client";
import { TOPICS, TOPIC_LABELS, type Topic } from "@/features/cards/schema";
import { INTENTS, INTENT_LABELS, RECALL_CADENCES, RECALL_CADENCE_LABELS, saveProfile, useProfile, type Intent, type RecallCadence } from "@/features/profile/profile";
import { saveSettings, useSettings } from "./settings";

export function SettingsPanel() {
  const settings = useSettings();
  const profile = useProfile();
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

      <section aria-labelledby="intent-title" className="space-y-3">
        <h2 id="intent-title" className="font-serif text-xl">
          牌想帮你做什么
        </h2>
        <fieldset className="space-y-1">
          <legend className="sr-only">牌想帮你做什么</legend>
          {[null, ...INTENTS].map((it) => (
            <label key={it ?? "none"} className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="radio"
                name="intent"
                checked={profile.intent === it}
                onChange={() => setSaveFailed(!saveProfile({ ...profile, onboarded: true, intent: it as Intent | null }))}
                className="h-6 w-6 shrink-0"
              />
              {it ? INTENT_LABELS[it] : "不指定（平实的默认语气）"}
            </label>
          ))}
        </fieldset>
        <p className="text-xs leading-relaxed text-muted">决定解读的语气：理清处境、帮你看清选项（不替你选）、或更柔和地陪你坐一会儿。只影响之后的占卜；“此刻”那张卡固定用陪伴语气。</p>
      </section>

      <section aria-labelledby="topics-title" className="space-y-3">
        <h2 id="topics-title" className="font-serif text-xl">
          常来的主题
        </h2>
        <fieldset className="space-y-1">
          <legend className="sr-only">常来的主题（可多选）</legend>
          {TOPICS.map((t) => (
            <label key={t} className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={profile.topics.includes(t)}
                onChange={(e) =>
                  setSaveFailed(!saveProfile({ ...profile, onboarded: true, topics: e.target.checked ? ([...profile.topics, t] as Topic[]) : profile.topics.filter((x) => x !== t) }))
                }
                className="h-6 w-6 shrink-0"
              />
              {TOPIC_LABELS[t]}
            </label>
          ))}
        </fieldset>
        <p className="text-xs text-muted">选了的主题，在“抽牌”页的情境卡里排在前面。</p>
      </section>

      <section aria-labelledby="recall-title" className="space-y-3">
        <h2 id="recall-title" className="font-serif text-xl">
          回来看看当时的自己
        </h2>
        <fieldset className="space-y-1">
          <legend className="sr-only">回看提醒的节奏</legend>
          {RECALL_CADENCES.map((c) => (
            <label key={c} className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="radio"
                name="recall"
                checked={(profile.recallCadence ?? "none") === c}
                onChange={() => setSaveFailed(!saveProfile({ ...profile, onboarded: true, recallCadence: c as RecallCadence }))}
                className="h-6 w-6 shrink-0"
              />
              {RECALL_CADENCE_LABELS[c]}
            </label>
          ))}
        </fieldset>
        <p className="text-xs leading-relaxed text-muted">选了之后，每次保存都会安排一次回看，到时候在首页和历史页轻轻提一句，可以随时忽略。只对之后保存的记录生效；不推送，不发通知。</p>
      </section>

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
