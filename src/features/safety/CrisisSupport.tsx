"use client";

import { useState } from "react";
import { HELP_RESOURCES, defaultRegionId } from "./resources";

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "";
  }
}

/** 危机分流页面内容：中止占卜后展示。不评价、不追问，只给出可以马上做的事。 */
export function CrisisSupport({ onExit, onEdit, exitLabel = "返回首页" }: { onExit: () => void; onEdit?: () => void; exitLabel?: string }) {
  const r = HELP_RESOURCES;
  // 先按时区猜，用户可以切换；不保存选择
  const [regionId, setRegionId] = useState(() => defaultRegionId(deviceTimeZone()));
  const region = r.regions.find((x) => x.id === regionId) ?? r.regions[0];
  return (
    <section aria-labelledby="crisis-title" className="space-y-5">
      <h2 id="crisis-title" className="font-serif text-2xl leading-snug">
        这一刻，先不抽牌了。
      </h2>
      <p className="leading-relaxed">
        你写下的内容让我们有点担心你。塔罗帮不上这种时刻，但有人可以——你不必一个人扛着。
      </p>
      <ul className="space-y-2">
        {r.advice.map((a) => (
          <li key={a} className="leading-relaxed text-ink/90">
            {a}
          </li>
        ))}
      </ul>
      <div className="rounded-lg bg-surface p-4">
        <div role="group" aria-label="选择你所在的地区" className="flex flex-wrap gap-2">
          {r.regions.map((x) => (
            <button
              key={x.id}
              type="button"
              aria-pressed={x.id === region.id}
              onClick={() => setRegionId(x.id)}
              className={`rounded-full border px-3 py-1.5 text-sm ${x.id === region.id ? "border-accent bg-accent text-bg" : "border-line"}`}
            >
              {x.label}
            </button>
          ))}
        </div>
        <dl className="mt-4 space-y-3" data-testid="help-items">
          {region.items.map((item) => (
            <div key={item.contact + item.name}>
              <dt className="text-sm">{item.name}</dt>
              <dd>
                <a href={`tel:${item.contact.replaceAll(" ", "")}`} className="font-serif text-2xl text-accent">
                  {item.contact}
                </a>
                <span className="ml-2 text-xs text-muted">{item.note}</span>
                <a href={item.source.url} target="_blank" rel="noreferrer" className="ml-2 text-xs text-muted underline underline-offset-2">
                  来源
                </a>
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-sm">
          <a href={r.directory.url} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-4">
            {r.directory.name}
          </a>
          <span className="block text-xs text-muted">不在上面的地区，可以用这个目录找当地的热线，或使用所在地的紧急电话。</span>
        </p>
        <p className="mt-3 text-xs text-muted">{region.label}的号码核对于 {region.checkedAt}，来源见各条“来源”链接。</p>
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={onExit} className="rounded-full border border-line px-5 py-2 text-sm text-muted hover:text-ink">
            {exitLabel}
          </button>
          {onEdit && (
            <button type="button" onClick={onEdit} className="rounded-full border border-line px-5 py-2 text-sm text-muted hover:text-ink">
              返回修改我写的内容
            </button>
          )}
        </div>
        {onEdit && (
          <p className="text-xs leading-relaxed text-muted">
            如果这是误会（比如在写小说或讨论新闻），可以回去修改，改完会重新检查。这一步不会跳过检查，也不会保存任何记录。
          </p>
        )}
      </div>
    </section>
  );
}
