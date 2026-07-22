# AI PPT Tutor

一个基于 PDF / PPTX 课件的 AI 学习工作区。上传课件后，系统会按页或幻灯片提取文本、建立分块索引，并在讲解、问答、练习和复习模式中返回可核查的课件来源。

## 本地运行

环境要求：Node.js 20 或更高版本。

```bash
npm install
cp .env.example .env.local
npm run dev
```

然后打开 [http://localhost:3000](http://localhost:3000)。在 `.env.local` 中填写 DashScope API Key 后，才能使用 AI 生成能力：

```dotenv
DASHSCOPE_API_KEY=your_dashscope_api_key
DASHSCOPE_VISION_MODEL=qwen3-vl-plus
```

不要提交包含真实密钥的 `.env.local`。

## 当前能力

- 支持 PDF、PPTX，单文件最大 20MB
- 提供“自动（推荐）”“不使用 OCR”和“全页 OCR”三种模式；自动模式只对文字层不足的页面运行 OCR
- PDF 与 PPTX 共用“页面渲染 → Canvas → Tesseract.js”管线，OCR 文本与原生文字去重合并，并按置信度降权
- 自动检测教学价值较高的图表、表格、流程图和代码截图，裁剪后由 `qwen3-vl-plus` 分析
- 图片来源保留页码、裁剪区域、视觉摘要和缩略图，回答可直接引用并在来源栏核对
- 文件格式、MIME、文件头、解析超时和内容上限校验
- 按页或幻灯片建立结构化分块；分别识别标题、定义、列表、表格与代码
- BM25 关键词检索与 `text-embedding-v4` 语义召回的混合检索
- 多查询改写、BM25、`text-embedding-v4`、RRF 融合和 MMR 去重组成混合召回
- 使用 `qwen3-rerank` 重排序，并综合标题、页码、相邻页、内容类型及 OCR/视觉可靠度
- 对“知识结构、整课概览、详细讲解”等全局问题使用按页全文覆盖，不再用少量 Top-K 片段代替整份课件
- 结构化回答、结论级引用、部分拒答与完全拒答
- 新增“导师教学”模式，按诊断、直觉解释、分步讲解、练习、掌握检查和下一步持续推进
- 深入讲解、课件问答、生成练习、复习总结四种任务模式继续保留
- 测验题目与答案分离，答案按需展开并绑定课件来源
- 可折叠来源栏、引用句高亮、回答反馈与上传失败重试
- PDF / PPTX 逐页 OCR、上传、解析、分块和向量化的真实进度；支持取消 OCR、取消上传和停止生成
- IndexedDB 本地持久化，刷新后保留课件索引、对话、学习模式和反馈
- 桌面三栏工作区和移动端文件／学习／引用标签页

当语义嵌入或重排序服务临时不可用时，系统会自动退回本地关键词检索，避免整个学习流程中断。

## 检查命令

```bash
npm test
npm run lint
npm run build
npm run eval
```

## 已知限制

- 全页 OCR 会消耗用户设备的 CPU、内存和电量；长课件在手机或低配置设备上处理较慢。
- OCR 当前使用简体中文和英文模型；复杂公式、低分辨率图表和特殊字体可能识别不准确。
- PDF.js Worker 已随项目自托管；Tesseract.js 的中英文语言资源首次使用仍需要网络加载，之后可利用浏览器缓存。
- OCR 本身在浏览器本地完成；自动模式检测到的候选图表裁剪会发送到本项目服务端和已配置的 DashScope 视觉模型。处理敏感课件前应确认数据合规要求。
- 学习记录和反馈目前仅保存在本机当前浏览器，尚未跨设备同步，也未接入运营分析后台。
- 当前向量索引随文档存储在浏览器中，适合单课件学习；大规模课件库需要服务端向量数据库。
- 已建立 OCR/RAG/图表联合评测脚本与场景权重；10 份真实课件生成的候选题仍需人工审核后才能成为正式金标准。

## 正式评测

评测说明位于 [`evaluation/README.md`](evaluation/README.md)。默认联合夹具运行：

```bash
npm run eval
```

根据真实课件生成候选评测题：

```bash
node --env-file=.env.local scripts/generate-evaluation-dataset.mjs /path/to/lecture1.pdf /path/to/lecture2.pdf
```

生成结果会明确标记为 `pending_human_review`；在人工确认问题、参考答案和相关页码前，不应将其视为正式成绩。
