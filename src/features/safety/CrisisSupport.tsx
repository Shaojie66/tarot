import { HELP_RESOURCES } from "./resources";

/** 危机分流页面内容：中止占卜后展示。不评价、不追问，只给出可以马上做的事。 */
export function CrisisSupport({ onExit, onEdit, exitLabel = "返回首页" }: { onExit: () => void; onEdit?: () => void; exitLabel?: string }) {
  const r = HELP_RESOURCES;
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
        <p className="text-xs text-muted">{r.region}</p>
        <dl className="mt-2 space-y-3">
          {r.items.map((item) => (
            <div key={item.contact}>
              <dt className="text-sm">{item.name}</dt>
              <dd>
                <a href={`tel:${item.contact}`} className="font-serif text-2xl text-accent">
                  {item.contact}
                </a>
                <span className="ml-2 text-xs text-muted">{item.note}</span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-sm">
          <a href={r.directory.url} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-4">
            {r.directory.name}
          </a>
        </p>
        <p className="mt-3 text-xs text-muted">信息核对于 {r.checkedAt}。不在中国大陆时，请使用所在地的紧急电话。</p>
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
