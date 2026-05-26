import { useMemo, useRef, useState } from "react";
import type { ClipboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type ImageError = {
  src: string;
  message: string;
};

type ConvertResult = {
  html: string;
  converted_count: number;
  skipped_count: number;
  errors: ImageError[];
};

type ConvertProgress = {
  total: number;
  processed: number;
};

const imageSrcPattern = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])(.*?)\2/gi;

const sampleHtml = `<html>
<body>
<!--StartFragment--><p>鼎丰财富中心119.94㎡精装【1605-B单元】</p><p>粗体</p><p>斜体</p><p>下划线</p><p>高亮</p><hr/><br/><p>1.列表1</p><br/><p>•列表2</p><br/><p>任务1</p><br/><br/><img src="\\\\Mac\\Home\\Documents\\xwechat_files\\xmszer_a1c0\\business\\favorite\\temp\\NoteCache\\微信图片_202605.png"/>
<!--EndFragment-->
</body>
</html>`;

function App() {
  const [source, setSource] = useState(sampleHtml);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<ConvertProgress | null>(null);
  const sourceInputRef = useRef<HTMLTextAreaElement | null>(null);

  const output = result?.html ?? "";
  const canConvert = source.trim().length > 0 && !isConverting;
  const summary = useMemo(() => {
    if (progress) return `转换中 ${progress.processed}/${progress.total}`;
    if (!result) return "等待转换";

    return `已转换 ${result.converted_count} 张图片，跳过 ${result.skipped_count} 张，失败 ${result.errors.length} 张`;
  }, [progress, result]);

  async function convertImages() {
    if (!source.trim()) return;

    setIsConverting(true);
    setError("");
    setResult(null);
    setProgress(null);
    setCopyState("idle");

    try {
      await yieldToBrowser();
      setResult(await inlineLocalImages(source, setProgress));
    } catch (caught) {
      setResult(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setProgress(null);
      setIsConverting(false);
    }
  }

  async function copyOutput() {
    if (!output) return;

    try {
      await writeRichHtmlToClipboard(output);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1600);
    } catch {
      setCopyState("failed");
    }
  }

  async function writeRichHtmlToClipboard(html: string) {
    const plainText = htmlToPlainText(html);

    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([plainText], { type: "text/plain" }),
          }),
        ]);
        return;
      }
    } catch {
      copyRichHtmlWithSelection(html, plainText);
      return;
    }

    copyRichHtmlWithSelection(html, plainText);
  }

  function copyRichHtmlWithSelection(html: string, plainText: string) {
    const previousFocus = document.activeElement;
    const container = document.createElement("div");

    container.contentEditable = "true";
    container.innerHTML = html;
    container.style.position = "fixed";
    container.style.left = "-9999px";
    container.style.top = "0";
    container.style.width = "1px";
    container.style.height = "1px";
    container.style.overflow = "hidden";
    container.addEventListener("copy", (event) => {
      event.clipboardData?.setData("text/html", html);
      event.clipboardData?.setData("text/plain", plainText);
      event.preventDefault();
    });

    document.body.appendChild(container);

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(container);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const copied = document.execCommand("copy");
    selection?.removeAllRanges();
    container.remove();

    if (previousFocus instanceof HTMLElement) {
      previousFocus.focus();
    }

    if (!copied) {
      throw new Error("复制失败");
    }
  }

  function handleSourcePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const html = event.clipboardData.getData("text/html");

    if (!html) return;

    event.preventDefault();

    const target = event.currentTarget;
    const selectionStart = target.selectionStart;
    const selectionEnd = target.selectionEnd;
    const nextSource =
      source.slice(0, selectionStart) + html + source.slice(selectionEnd);
    const nextCursorPosition = selectionStart + html.length;

    setSource(nextSource);
    setResult(null);
    setError("");
    setProgress(null);
    setCopyState("idle");

    window.requestAnimationFrame(() => {
      const input = sourceInputRef.current;

      if (!input) return;

      input.selectionStart = nextCursorPosition;
      input.selectionEnd = nextCursorPosition;
    });
  }

  async function inlineLocalImages(
    html: string,
    onProgress: (progress: ConvertProgress) => void,
  ): Promise<ConvertResult> {
    let convertedCount = 0;
    let skippedCount = 0;
    const errors: ImageError[] = [];
    const replacements = new Map<string, string>();
    const matches = Array.from(html.matchAll(imageSrcPattern));
    let processedCount = 0;

    onProgress({ total: matches.length, processed: processedCount });
    await yieldToBrowser();

    for (const match of matches) {
      const src = decodeHtmlAttr(match[3] ?? "");

      if (shouldSkipSrc(src)) {
        skippedCount += 1;
        processedCount += 1;
        onProgress({ total: matches.length, processed: processedCount });
        await yieldToBrowser();
        continue;
      }

      try {
        const dataUrl = await invoke<string>("local_image_to_data_url", { src });
        replacements.set(src, dataUrl);
        convertedCount += 1;
      } catch (caught) {
        errors.push({
          src,
          message: caught instanceof Error ? caught.message : String(caught),
        });
      }

      processedCount += 1;
      onProgress({ total: matches.length, processed: processedCount });
      await yieldToBrowser();
    }

    const convertedHtml = html.replace(
      imageSrcPattern,
      (fullMatch, prefix: string, quote: string, rawSrc: string) => {
        const replacement = replacements.get(decodeHtmlAttr(rawSrc));

        if (!replacement) return fullMatch;

        return `${prefix}${quote}${escapeHtmlAttr(replacement)}${quote}`;
      },
    );

    await yieldToBrowser();

    return {
      html: convertedHtml,
      converted_count: convertedCount,
      skipped_count: skippedCount,
      errors,
    };
  }

  function shouldSkipSrc(src: string) {
    const value = src.trim().toLowerCase();

    return (
      value.length === 0 ||
      value.startsWith("data:") ||
      value.startsWith("http://") ||
      value.startsWith("https://") ||
      value.startsWith("blob:")
    );
  }

  function decodeHtmlAttr(value: string) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;

    return textarea.value;
  }

  function escapeHtmlAttr(value: string) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function htmlToPlainText(html: string) {
    const container = document.createElement("div");
    container.innerHTML = html;

    return container.innerText;
  }

  function yieldToBrowser() {
    return new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });
  }

  function clearAll() {
    setSource("");
    setResult(null);
    setError("");
    setProgress(null);
    setCopyState("idle");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>微信笔记图片内嵌工具</h1>
          <p>粘贴 HTML，自动把本地图片路径转换成 base64。</p>
        </div>
        <div className="actions">
          <button type="button" className="secondary" onClick={clearAll}>
            清空
          </button>
          <button type="button" onClick={convertImages} disabled={!canConvert}>
            {isConverting ? "转换中..." : "转换"}
          </button>
        </div>
      </header>

      <section className="workspace">
        <label className="pane">
          <span>输入</span>
          <textarea
            ref={sourceInputRef}
            value={source}
            onChange={(event) => setSource(event.currentTarget.value)}
            onPaste={handleSourcePaste}
            placeholder="把微信复制出来的 HTML 粘贴到这里"
            spellCheck={false}
          />
        </label>

        <section className="pane">
          <div className="pane-title">
            <span>输出</span>
            <button
              type="button"
              className="secondary"
              onClick={copyOutput}
              disabled={!output}
            >
              {copyState === "copied"
                ? "已复制"
                : copyState === "failed"
                  ? "复制失败"
                  : "复制结果"}
            </button>
          </div>
          <textarea
            value={output}
            readOnly
            placeholder="转换后的 HTML 会显示在这里"
            spellCheck={false}
          />
        </section>
      </section>

      <footer className="statusbar">
        <span>{summary}</span>
        {error ? <strong>{error}</strong> : null}
        {result?.errors.map((item) => (
          <strong key={`${item.src}-${item.message}`}>
            {item.message}: {item.src}
          </strong>
        ))}
      </footer>
    </main>
  );
}

export default App;
