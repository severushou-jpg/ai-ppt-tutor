import { NextResponse } from 'next/server';
import officeParser from 'officeparser';
import pdf from 'pdf-parse-fork'; // 关键：使用新的库

export async function POST(req) {
  try {
    const API_KEY = process.env.DASHSCOPE_API_KEY;
    
    // 检查环境变量是否读取成功
    if (!API_KEY) {
      console.error("❌ 错误：环境变量 DASHSCOPE_API_KEY 未找到");
      return NextResponse.json({ error: "服务器 API Key 配置缺失" }, { status: 500 });
    }

    const formData = await req.formData();
    const file = formData.get('file');
    const question = formData.get('question');
    const history = JSON.parse(formData.get('history') || '[]');

    let pdfText = "";

    if (file && file instanceof File && file.size > 0) {
      console.log(`📂 正在解析文件: ${file.name}, 大小: ${file.size} bytes`);
      
      const buffer = Buffer.from(await file.arrayBuffer());
      
      try {
        if (file.name.toLowerCase().endsWith('.pdf')) {
          // pdf-parse-fork 的标准用法
          const data = await pdf(buffer);
          pdfText = data.text;
        } else {
          pdfText = await new Promise((res, rej) => {
            officeParser.parseOffice(buffer, (data, err) => err ? rej(err) : res(data));
          });
        }
        console.log("✅ 文件解析成功，提取字数:", pdfText.length);
      } catch (parseErr) {
        console.error("❌ 文件内容提取失败:", parseErr);
        return NextResponse.json({ error: "无法读取文件内容，请确保不是加密文件或纯图片扫描件" }, { status: 400 });
      }
    }

    // 调用 AI 逻辑
    const systemMessage = {
      role: "system",
      content: `你是一位世界级大学教授，同时也是最会教学的老师。

请根据用户上传的学习资料内容，进行系统化讲解，要求：

1. 先告诉学生本章节学什么
2. 用初学者也能听懂的语言讲解
3. 每个知识点给生活化例子
4. 标注考试高频考点
5. 指出学生最容易犯错的地方
6. 如涉及公式，解释公式每一项代表什么
7. 最后总结本章重点
8. 语气像优秀老师，而不是机器人
9. 内容详细但有逻辑层次
10. 如果内容较多，请分模块讲解

输出格式：

【本章概览】
【知识点1】
【例子】
【易错点】
【考试重点】
【知识点2】
...
【最终总结】。用中文讲解，使用 Markdown 格式。
      ${pdfText ? `\n【课件内容】\n${pdfText.substring(0, 25000)}` : ""}`
    };

    const messages = [systemMessage, ...history, { role: "user", content: question }];

    console.log("🤖 正在请求通义千问 API...");
    const response = await fetch("https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: "qwen-plus",
        input: { messages },
        parameters: { result_format: "message" }
      })
    });

    const data = await response.json();

    if (!response.ok || data.code) {
      console.error("❌ API 返回错误:", data);
      return NextResponse.json({ error: data.message || "AI 响应失败" }, { status: 500 });
    }

    return NextResponse.json({ content: data.output.choices[0].message.content });

  } catch (error) {
    // 这里会打印具体的报错到你的终端（Terminal）里，请查看那里！
    console.error("🚨 后端发生致命错误:", error);
    return NextResponse.json({ error: `系统错误: ${error.message}` }, { status: 500 });
  }
}