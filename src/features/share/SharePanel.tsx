"use client";

import { useEffect, useRef, useState } from "react";
import type { ReadingRecord } from "@/features/reading/contract";
import { randomId } from "@/lib/id";
import { renderShareImage } from "./render-share";
import { DEFAULT_SHARE_OPTIONS, buildShareModel, describeShare, shareableAction, type ShareOptions } from "./share-model";

/** 本地生成分享图。默认只含牌名、正逆位、位置、关键词、牌组署名和固定免责声明；问题和小行动要勾选才会进图，并且先预览。 */
export function SharePanel({ record }: { record: ReadingRecord }) {
  const [options, setOptions] = useState<ShareOptions>(DEFAULT_SHARE_OPTIONS);
  const [preview, setPreview] = useState<{ url: string; description: string; blob: Blob } | null>(null);
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  const urlRef = useRef<string | null>(null);
  const action = shareableAction(record);
  const model = buildShareModel(record, options);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  function reset(next: ShareOptions) {
    setOptions(next);
    // 选项变了，之前的预览就不再对应当前选择：作废，要重新生成
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setPreview(null);
    setState("idle");
  }

  async function generate() {
    setState("working");
    try {
      const blob = await renderShareImage(model);
      const url = URL.createObjectURL(blob);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      setPreview({ url, blob, description: describeShare(model) });
      setState("idle");
    } catch {
      setState("failed");
    }
  }

  return (
    <section aria-labelledby="share-title" className="space-y-3">
      <h3 id="share-title" className="font-serif text-lg">
        导出分享图
      </h3>
      <p className="text-xs leading-relaxed text-muted">
        图片在你的浏览器里生成，不会上传。默认只有牌面、正逆位、位置、关键词和固定的说明；不含你的问题、自解、解读、笔记、日期，也没有网址。
      </p>
      <fieldset className="space-y-2 rounded-lg border border-line p-3">
        <legend className="px-1 text-xs text-muted">想让图里多出现什么？（默认都不要）</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={options.includeQuestion} onChange={(e) => reset({ ...options, includeQuestion: e.target.checked })} className="mt-1" />
          <span>我的问题：“{record.request.question}”</span>
        </label>
        <label className={`flex items-start gap-2 text-sm ${action ? "" : "opacity-50"}`}>
          <input type="checkbox" disabled={!action} checked={options.includeAction && !!action} onChange={(e) => reset({ ...options, includeAction: e.target.checked })} className="mt-1" />
          <span>{action ? `我的小行动：“${action}”` : "我的小行动（你还没决定做它，没有可放的内容）"}</span>
        </label>
      </fieldset>

      <button type="button" onClick={() => void generate()} disabled={state === "working"} className="rounded-full border border-line px-4 py-1.5 text-sm disabled:opacity-40">
        {state === "working" ? "生成中…" : "生成预览"}
      </button>
      {state === "failed" && (
        <p role="alert" className="text-sm">
          生成失败：这个浏览器没能画出图片。可以重试，或换一个浏览器。
        </p>
      )}

      {preview && (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview.url} alt={preview.description} data-testid="share-preview" className="w-full rounded-lg border border-line" />
          <p className="whitespace-pre-line text-xs text-muted" data-testid="share-contents">
            {"这张图里的全部内容：\n" + preview.description}
          </p>
          <a href={preview.url} download={`tarot-share-${randomId().slice(0, 6)}.png`} className="inline-block rounded-full bg-accent px-4 py-1.5 text-sm text-bg">
            下载图片
          </a>
        </div>
      )}
    </section>
  );
}
