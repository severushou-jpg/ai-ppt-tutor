'use client';

import { useState, useRef, useEffect, ChangeEvent, KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import { Send, Upload, FileText, Brain, RotateCcw, Loader2 } from 'lucide-react';

// 定义消息对象的结构
interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [input, setInput] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 自动滚动
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 处理文件上传选择
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const askAI = async (customText?: string) => {
    const targetText = customText || input;
    if (!targetText && !file) return;

    setLoading(true);
    const userMsg: Message = { role: 'user', content: targetText || "请根据课件开始教学" };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');

    try {
      const formData = new FormData();
      if (file) formData.append('file', file);
      formData.append('question', userMsg.content);
      // 传递最近的上下文
      formData.append('history', JSON.stringify(messages.slice(-10)));

      const res = await fetch('/api/ai', { method: 'POST', body: formData });
      const data = await res.json();

      if (data.error) throw new Error(data.error);

      setMessages(prev => [...prev, { role: 'assistant', content: data.content }]);
      if (file) setFile(null); 
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: "⚠️ 出错了：" + err.message }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !loading) {
      askAI();
    }
  };

  return (
    <div className="flex h-screen bg-gray-50 text-slate-900">
      <aside className="w-80 bg-white border-r flex flex-col p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-10 text-blue-600">
          <Brain size={32} />
          <h1 className="text-xl font-bold tracking-tight">Severus' AI 课件私教</h1>
        </div>

        <div className="flex-1 space-y-6">
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">上传教学课件</h3>
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-200 rounded-2xl cursor-pointer hover:bg-blue-50 transition-all">
              <Upload className="text-gray-400 mb-2" />
              <p className="text-xs text-center px-4 text-gray-500 overflow-hidden text-ellipsis">
                {file ? file.name : "点击上传 (PDF/PPT)"}
              </p>
              <input type="file" className="hidden" onChange={handleFileChange} accept=".pdf,.pptx" />
            </label>
            {file && (
              <button onClick={() => askAI()} className="w-full mt-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                开始学习
              </button>
            )}
          </section>

          <section className="pt-6 border-t">
            <button onClick={() => askAI("请根据当前课件内容，为我出一份练习题。")} className="w-full mb-2 flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
              <FileText size={16} /> 测验模式
            </button>
            <button onClick={() => setMessages([])} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50 rounded-lg">
              <RotateCcw size={16} /> 清空记录
            </button>
          </section>
        </div>
      </aside>

      <main className="flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto p-8 space-y-6">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-gray-300">
              <p>请上传 PDF 并向 AI 教授提问</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] px-6 py-4 rounded-2xl shadow-sm ${
                m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white border prose prose-slate max-w-none'
              }`}>
                <ReactMarkdown>{m.content}</ReactMarkdown>
              </div>
            </div>
          ))}
          <div ref={scrollRef} />
        </div>

        <div className="p-6 bg-white border-t">
          <div className="max-w-3xl mx-auto flex gap-4">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="提问..."
              className="flex-1 bg-gray-100 px-6 py-3 rounded-full focus:outline-none"
            />
            <button onClick={() => askAI()} className="w-12 h-12 flex items-center justify-center bg-blue-600 text-white rounded-full">
              {loading ? <Loader2 className="animate-spin" /> : <Send size={20} />}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}