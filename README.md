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
```

不要提交包含真实密钥的 `.env.local`。

## 当前能力

- 支持 PDF、PPTX，单文件最大 20MB
- 文件格式、MIME、文件头、解析超时和内容上限校验
- 按页或幻灯片分块，保留来源位置
- 中英文关键词检索与课件内 RAG
- 回答引用、来源原文面板和证据不足拒答
- 深入讲解、课件问答、生成练习、复习总结四种学习模式
- 桌面三栏工作区和移动端文件／学习／引用标签页
- 上传进度、解析状态、取消上传、停止生成和结构化错误提示

## 检查命令

```bash
npm test
npm run lint
npm run build
```

## 已知限制

- 当前检索是本地词法检索，不是向量数据库或语义嵌入检索。
- 暂不支持扫描件 OCR；没有文本层的文件会提示用户更换文件。
- 文档索引保存在当前浏览器页面状态中，刷新页面后需要重新上传。
- 当前版本未包含用户账号、数据库和学习效果测评。
