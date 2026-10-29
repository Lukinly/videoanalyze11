import { useState } from "react";

export function PublicPreview() {
  const [tab, setTab] = useState("notes");
  return <section className="public-preview" id="product-preview" aria-label="产品示例预览">
    <div className="preview-window-bar"><span className="preview-window-dots" aria-hidden="true"><i /><i /><i /></span><span>十一 · 视频工作台</span><span className="preview-example-label">示例预览</span></div>
    <div className="preview-content"><div className="preview-file"><span className="preview-file-icon" aria-hidden="true">▷</span><span>如何更有效地学习.mp4</span><span className="preview-ready">已完成</span></div>
      <div className="preview-video" aria-hidden="true"><span className="preview-video-kicker">LEARN WITH PURPOSE</span><strong>理解，<br />比记住更重要。</strong><span className="preview-video-orbit" /><div className="preview-video-footer"><span>▷</span><div><i /></div><span>00:27 / 08:32</span></div></div>
      <div className="preview-tabs" role="tablist" aria-label="示例内容"><button id="preview-notes-tab" role="tab" aria-selected={tab === "notes"} aria-controls="preview-panel" onClick={() => setTab("notes")}>AI 笔记</button><button id="preview-timeline-tab" role="tab" aria-selected={tab === "timeline"} aria-controls="preview-panel" onClick={() => setTab("timeline")}>时间轴</button><button id="preview-summary-tab" role="tab" aria-selected={tab === "summary"} aria-controls="preview-panel" onClick={() => setTab("summary")}>摘要</button></div>
      <div className="preview-note" id="preview-panel" role="tabpanel" aria-labelledby={`preview-${tab}-tab`}>
        {tab === "notes" ? <><div className="preview-note-heading"><h3>从被动观看，到主动理解</h3><span>00:27 – 01:38</span></div><p>用自己的语言复述一个概念，再结合例子检验理解。遇到不清楚的地方，回到对应片段重新梳理。</p><div className="preview-note-tags"><span>核心概念</span><span>原片回看</span><span>复习要点</span></div></>
          : tab === "timeline" ? <ol className="preview-timeline"><li><time>00:00</time><span>为什么看过，却没有记住</span></li><li><time>00:27</time><span>用自己的语言解释概念</span></li><li><time>03:12</time><span>通过练习建立反馈</span></li></ol>
            : <><h3>把观看变成真正的学习</h3><p>先明确问题，再带着目标观看。结合复述、练习和反馈，把视频中的知识整理成可以复习的笔记。</p></>}
      </div>
    </div>
  </section>;
}

export function PublicFeatures() {
  return <section className="public-features" id="features" aria-labelledby="features-title"><div className="public-section-heading"><p className="eyebrow">FROM WATCHING TO KNOWING</p><h2 id="features-title">少一点反复拖动，多一点真正理解。</h2><p>从第一次观看，到下一次复习，让知识有迹可循。</p></div><div className="public-feature-grid">
    <article><span className="public-feature-number">01 / 导入</span><h3>从你的视频开始</h3><p>上传本地视频，或粘贴公开视频链接。课程、讲座、知识分享，都能在这里整理。</p></article>
    <article><span className="public-feature-number">02 / 整理</span><h3>把内容变成笔记</h3><p>逐字稿、章节摘要、详细笔记与关键画面放在一起，读懂每个片段的上下文。</p></article>
    <article><span className="public-feature-number">03 / 回顾</span><h3>回到关键的那一刻</h3><p>搜索想找的内容，点击笔记时间范围回看原片，也可以导出文字，继续自己的整理。</p></article>
  </div></section>;
}
