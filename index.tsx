import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Type } from "@google/genai";
import {
  BookOpen,
  Library,
  BarChart3,
  Search,
  CheckCircle2,
  Clock,
  ChevronLeft,
  Highlighter,
  Sparkles,
  Play,
  MoreVertical,
  Quote,
  X,
  BrainCircuit,
  Plus,
  Flame,
  Trophy,
  ArrowRight,
  PauseCircle,
  StickyNote,
  Trash2,
  PenLine,
  Save,
  Calendar as CalendarIcon,
  ChevronRight,
  Star,
  Settings,
  RotateCcw
} from "lucide-react";

// --- Configuration & Types ---

const AI_MODEL_FLASH = "gemini-2.5-flash";

// Initialize AI
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

interface Book {
  id: string;
  title: string;
  author: string;
  coverColor: string; // Simulating realistic covers with gradients
  category: string;
  totalChapters: number;
  currentChapter: number;
  status: "unread" | "reading" | "finished" | "paused";
  progress: number; // 0 to 100
  lastReadDate?: string;
  rating?: number; // Douban Rating
  description?: string; // Brief intro
}

interface DailyFragment {
  bookId: string;
  chapter: number;
  content: string; // The "original" text
  summary: string;
  context: string;
  quotes: string[];
  estimatedMinutes: number;
  isCompleted: boolean;
}

interface Highlight {
  id: string;
  bookId: string;
  text: string;
  chapter: number;
  note?: string;
  createdAt: string;
  sourceSection?: "content" | "summary" | "quote"; // Track where it came from
}

interface UserStats {
  dailyStreak: number;
  totalMinutesRead: number;
  lastCheckIn: string;
  // Key: YYYY-MM-DD, Value: Minutes read
  readingHistory: Record<string, number>;
}

// --- Mock Data Seeds (Chinese) ---
const INITIAL_BOOKS: Book[] = [
  {
    id: "1",
    title: "三体",
    author: "刘慈欣",
    coverColor: "from-slate-900 to-blue-900",
    category: "科幻",
    totalChapters: 35,
    currentChapter: 0,
    status: "unread",
    progress: 0,
    rating: 9.3,
    description: "讲述了地球人类文明和三体文明的信息交流、生死搏杀及两个文明在宇宙中的兴衰历程。"
  }
];

// --- Components ---

const App = () => {
  const [activeTab, setActiveTab] = useState<"discover" | "shelf" | "stats">("discover");
  const [books, setBooks] = useState<Book[]>(INITIAL_BOOKS);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [stats, setStats] = useState<UserStats>({
    dailyStreak: 0,
    totalMinutesRead: 0,
    lastCheckIn: "",
    readingHistory: {},
  });
  const [seenTitles, setSeenTitles] = useState<Set<string>>(new Set(INITIAL_BOOKS.map(b => b.title)));

  // Discovery Logic (Hoisted for Preloading)
  const [recommendations, setRecommendations] = useState<Book[]>([]);
  const [isDiscoveryLoading, setIsDiscoveryLoading] = useState(false);

  // Navigation handling for Reader
  const [activeBookId, setActiveBookId] = useState<string | null>(null);

  // --- Caching & Preloading Logic ---
  const [fragmentCache, setFragmentCache] = useState<Record<string, DailyFragment>>({});
  const [isPreloading, setIsPreloading] = useState(false);

  const getCacheKey = (bookId: string, chapter: number) => `${bookId}-${chapter}`;

  // --- Discovery API ---
  const getRecommendations = async (searchQuery: string = "") => {
    setIsDiscoveryLoading(true);
    try {
      // Filter books that are already on the shelf or have been seen
      const currentSeen = Array.from(seenTitles);
      // We limit the 'exclude' list string length to avoid token limits if it gets huge, 
      // though for this demo it's fine.
      const excludeList = currentSeen.slice(-20).join(", "); 
      
      const prompt = searchQuery
        ? `用户想找 "${searchQuery}" 相关的书。请推荐8本中文书籍。不要包含这些书: ${excludeList}。`
        : `推荐8本公认的高分热门中文书籍，涵盖小说、历史、商业或个人成长。不要包含这些书: ${excludeList}。`;

      const response = await ai.models.generateContent({
        model: AI_MODEL_FLASH,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                author: { type: Type.STRING },
                category: { type: Type.STRING },
                rating: { type: Type.NUMBER, description: "Douban score out of 10, e.g. 9.2" },
                description: { type: Type.STRING, description: "30-50字的中文简介，概括主要内容和主题" },
              },
            },
          },
        },
      });

      const rawBooks = JSON.parse(response.text || "[]");
      
      // Update seen titles
      const newTitles = new Set(seenTitles);
      rawBooks.forEach((b: any) => newTitles.add(b.title));
      setSeenTitles(newTitles);

      // Transform to Book objects
      const newRecs: Book[] = rawBooks.map((b: any, i: number) => ({
        id: `rec-${Date.now()}-${i}`,
        title: b.title,
        author: b.author,
        category: b.category,
        coverColor: getRandomCoverGradient(),
        totalChapters: 20, // Mock
        currentChapter: 0,
        status: "unread",
        progress: 0,
        rating: b.rating,
        description: b.description
      }));

      setRecommendations(newRecs);
    } catch (e) {
      console.error(e);
    } finally {
      setIsDiscoveryLoading(false);
    }
  };

  // Preload Recommendations Effect
  useEffect(() => {
      if (recommendations.length === 0) {
          getRecommendations("");
      }
  }, []);

  const fetchFragmentData = async (book: Book, chapter: number): Promise<DailyFragment | null> => {
    const key = getCacheKey(book.id, chapter);
    if (fragmentCache[key]) {
        return fragmentCache[key];
    }

    try {
        const targetChapter = chapter === 0 ? 1 : chapter;
        const prompt = `扮演书籍《${book.title}》（作者：${book.author}）。
        请生成第 ${targetChapter} 章的内容，内容必须是【中文】。
        
        要求：
        1. 提供约 2500 字的详细正文，务必保留原著的细节描写和完整性，不要简略。
        2. 提取精彩金句。
        
        严格返回以下JSON格式:
        {
          "summary": "2句关于本章的中文摘要",
          "context": "关于这部分内容如何承接上文的中文说明",
          "content": "章节的详细长文本正文内容...",
          "quotes": ["金句1", "金句2", "金句3"],
          "estimatedMinutes": 15
        }`;

        const response = await ai.models.generateContent({
            model: AI_MODEL_FLASH,
            contents: prompt,
            config: { responseMimeType: "application/json" }
        });
        
        const data = JSON.parse(response.text || "{}");
        
        const newFragment: DailyFragment = {
            bookId: book.id,
            chapter: targetChapter,
            content: data.content,
            summary: data.summary,
            context: data.context,
            quotes: data.quotes || [],
            estimatedMinutes: data.estimatedMinutes || 15,
            isCompleted: false
        };

        setFragmentCache(prev => ({ ...prev, [key]: newFragment }));
        return newFragment;
    } catch (e) {
        console.error("Failed to fetch fragment", e);
        return null;
    }
  };

  // Preload Effect: Automatically fetch current chapter for "Reading" books
  useEffect(() => {
    const preloadActiveBooks = async () => {
        const readingBooks = books.filter(b => b.status === "reading");
        for (const book of readingBooks) {
             const key = getCacheKey(book.id, book.currentChapter);
             if (!fragmentCache[key] && !isPreloading) {
                 // Only preload one at a time to be nice to rate limits
                 setIsPreloading(true);
                 console.log("Preloading chapter for:", book.title);
                 await fetchFragmentData(book, book.currentChapter);
                 setIsPreloading(false);
                 break; // Preload one then wait for next effect cycle
             }
        }
    };
    preloadActiveBooks();
  }, [books, fragmentCache]); // Re-run when books status changes

  const handleStartReading = async (book: Book) => {
    setActiveBookId(book.id);
    // If status is unread/paused, move to reading
    if (book.status === "unread" || book.status === "paused") {
      setBooks(prev => prev.map(b => b.id === book.id ? { ...b, status: "reading", currentChapter: b.currentChapter === 0 ? 1 : b.currentChapter } : b));
    }
  };

  const togglePlanStatus = (bookId: string, isReading: boolean, startChapter?: number) => {
      setBooks(prev => prev.map(b => {
          if (b.id === bookId) {
              const newState = isReading ? "reading" : "paused";
              let newChapter = b.currentChapter;
              let newProgress = b.progress;

              // If starting a plan and a chapter is specified
              if (isReading && startChapter !== undefined) {
                  newChapter = startChapter;
                  newProgress = Math.round(((startChapter - 1) / b.totalChapters) * 100);
              } 
              // Default fallback for unread books if no chapter specified (though UI should provide it)
              else if (isReading && b.currentChapter === 0) {
                  newChapter = 1;
                  newProgress = 0;
              }

              return { 
                  ...b, 
                  status: newState,
                  currentChapter: newChapter,
                  progress: newProgress
              };
          }
          return b;
      }));
  };

  const updateStatsOnRead = (minutes: number) => {
      const today = new Date().toISOString().split('T')[0];
      setStats(prev => {
          const newHistory = { ...prev.readingHistory };
          newHistory[today] = (newHistory[today] || 0) + minutes;
          
          // Simple streak logic: if last check-in was yesterday, increment streak. If today, keep. Else 1.
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayStr = yesterday.toISOString().split('T')[0];
          
          let newStreak = prev.dailyStreak;
          if (prev.lastCheckIn === yesterdayStr) {
              newStreak += 1;
          } else if (prev.lastCheckIn !== today) {
              // Reset if missed a day (and it wasn't just initialized)
              // For a real app, we'd check strictly. Here we assume if not yesterday and not today, it's broken
              // unless it's the first usage.
              if (prev.lastCheckIn < yesterdayStr) newStreak = 1;
          }

          return {
              ...prev,
              totalMinutesRead: prev.totalMinutesRead + minutes,
              readingHistory: newHistory,
              lastCheckIn: today,
              dailyStreak: newStreak
          };
      });
  };

  // If reading a book, show Reader View
  if (activeBookId) {
    const book = books.find((b) => b.id === activeBookId);
    if (!book) return null;
    
    const cacheKey = getCacheKey(book.id, book.currentChapter);
    const initialFragment = fragmentCache[cacheKey] || null;

    return (
      <ReaderView
        book={book}
        initialFragment={initialFragment}
        fetchFragment={fetchFragmentData}
        onClose={() => {
          setActiveBookId(null);
        }}
        updateBookProgress={(id, chapter, progress, completed, minutesSpent) => {
          setBooks((prev) =>
            prev.map((b) =>
              b.id === id
                ? {
                    ...b,
                    currentChapter: chapter,
                    progress: progress,
                    status: completed ? "finished" : "reading",
                  }
                : b
            )
          );
          updateStatsOnRead(minutesSpent);
        }}
        highlights={highlights.filter((h) => h.bookId === book.id)}
        addHighlight={(h) => setHighlights([...highlights, h])}
        deleteHighlight={(id) => setHighlights(prev => prev.filter(h => h.id !== id))}
        stats={stats}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20 max-w-md mx-auto shadow-2xl overflow-hidden border-x border-gray-200 relative font-sans">
      {/* Main Content Area */}
      <div className="h-full overflow-y-auto no-scrollbar">
        {activeTab === "discover" && (
          <DiscoverView 
            onAddBook={(book) => {
                setBooks([...books, book]);
                setSeenTitles(prev => new Set(prev).add(book.title));
            }} 
            existingBooks={books} 
            recommendations={recommendations}
            isLoading={isDiscoveryLoading}
            onSearch={getRecommendations}
            onRefresh={() => getRecommendations("")}
          />
        )}
        {activeTab === "shelf" && (
          <BookshelfView
            books={books}
            onOpenBook={handleStartReading}
            onTogglePlan={togglePlanStatus}
            highlights={highlights}
            onGoToDiscover={() => setActiveTab("discover")}
          />
        )}
        {activeTab === "stats" && <StatsView stats={stats} />}
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 w-full max-w-md bg-white/90 backdrop-blur-md border-t border-gray-200 flex justify-around items-center py-3 z-50 pb-6">
        <NavIcon
          icon={<Search size={24} />}
          label="发现"
          active={activeTab === "discover"}
          onClick={() => setActiveTab("discover")}
        />
        <NavIcon
          icon={<Library size={24} />}
          label="书架"
          active={activeTab === "shelf"}
          onClick={() => setActiveTab("shelf")}
        />
        <NavIcon
          icon={<BarChart3 size={24} />}
          label="统计"
          active={activeTab === "stats"}
          onClick={() => setActiveTab("stats")}
        />
      </div>
    </div>
  );
};

const NavIcon = ({ icon, label, active, onClick }: any) => (
  <button
    onClick={onClick}
    className={`flex flex-col items-center transition-colors ${
      active ? "text-indigo-600" : "text-gray-400 hover:text-gray-600"
    }`}
  >
    {icon}
    <span className="text-[10px] font-medium mt-1">{label}</span>
  </button>
);

// --- VIEW: Discovery ---

const DiscoverView = ({ 
    onAddBook, 
    existingBooks,
    recommendations,
    isLoading,
    onSearch,
    onRefresh
}: { 
    onAddBook: (b: Book) => void, 
    existingBooks: Book[],
    recommendations: Book[],
    isLoading: boolean,
    onSearch: (q: string) => void,
    onRefresh: () => void
}) => {
  const [query, setQuery] = useState("");

  return (
    <div className="p-5 space-y-6 pt-12 bg-white min-h-screen">
      <h1 className="text-2xl font-bold text-gray-900">发现好书</h1>
      
      <div className="relative">
        <input
          type="text"
          placeholder="搜索书名、作者或分类..."
          className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-12 pr-4 shadow-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-all text-sm"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSearch(query)}
        />
        <Search className="absolute left-4 top-3.5 text-gray-400" size={18} />
      </div>

      <div>
        <div className="flex justify-between items-center mb-4">
            <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
                <Sparkles size={16} className="text-indigo-500" />
                为你推荐
            </h2>
            <button 
                onClick={onRefresh}
                disabled={isLoading}
                className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors active:rotate-180 duration-300 disabled:opacity-50"
            >
                <RotateCcw size={16} />
            </button>
        </div>

        {isLoading ? (
           <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>
        ) : (
          // List Layout for Detailed Recommendations
          <div className="space-y-4">
            {recommendations.map((book) => {
                const isOwned = existingBooks.some(b => b.title === book.title);
                
                // Even if owned, we might show it but disabled? Or just skip. Logic says skip if isOwned
                if (isOwned) return null;

                return (
                <div key={book.id} className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex gap-4 group relative hover:shadow-md transition-all">
                     {/* Cover */}
                     <div className={`w-20 aspect-[2/3] rounded shadow-sm bg-gradient-to-br ${book.coverColor} flex-shrink-0 flex flex-col p-2 items-center justify-center`}>
                         <div className="text-[10px] text-white/90 font-bold text-center leading-tight line-clamp-3">{book.title}</div>
                     </div>
                     
                     <div className="flex-1 min-w-0 flex flex-col">
                         <div className="flex justify-between items-start">
                             <h3 className="font-bold text-gray-900 text-base leading-tight truncate mr-2">{book.title}</h3>
                             {book.rating && (
                                 <div className="flex items-center gap-1 bg-orange-50 px-1.5 py-0.5 rounded text-[10px] font-bold text-orange-600 shrink-0">
                                     <Star size={10} fill="currentColor"/>
                                     {book.rating}
                                 </div>
                             )}
                         </div>
                         
                         <p className="text-xs text-gray-500 mt-1 mb-2 truncate">{book.author} · {book.category}</p>
                         
                         {book.description && (
                             <p className="text-xs text-gray-600 leading-relaxed line-clamp-2 bg-gray-50 p-2 rounded-lg">
                                 {book.description}
                             </p>
                         )}
                         
                         <div className="mt-auto pt-2 flex justify-end">
                            <button 
                                onClick={() => onAddBook(book)}
                                className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-full font-medium shadow-sm hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-1"
                            >
                                <Plus size={14} /> 加入书架
                            </button>
                         </div>
                     </div>
                </div>
                )
            })}
          </div>
        )}
        {recommendations.length === 0 && !isLoading && (
            <p className="text-gray-400 text-sm text-center py-10">暂无新推荐</p>
        )}
      </div>
    </div>
  );
};

// --- VIEW: Bookshelf ---

const BookshelfView = ({ 
    books, 
    onOpenBook, 
    onTogglePlan,
    highlights,
    onGoToDiscover
}: { 
    books: Book[], 
    onOpenBook: (b: Book) => void, 
    onTogglePlan: (id: string, isReading: boolean, startChapter?: number) => void,
    highlights: Highlight[],
    onGoToDiscover: () => void
}) => {
  const [filter, setFilter] = useState<"all" | "reading">("all");
  const [selectedBookForReport, setSelectedBookForReport] = useState<Book | null>(null);
  const [selectedBookForNotes, setSelectedBookForNotes] = useState<Book | null>(null);
  
  // Plan Setup State
  const [planningBook, setPlanningBook] = useState<Book | null>(null);
  const [startChapterInput, setStartChapterInput] = useState<string>("1");

  const [generatedReport, setGeneratedReport] = useState<string | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const readingBooks = books.filter(b => b.status === "reading");
  const displayBooks = filter === "all" ? books : readingBooks;
  
  const generateReport = async (book: Book) => {
    setSelectedBookForReport(book);
    setMenuOpenId(null);
    setIsGeneratingReport(true);
    setGeneratedReport(null);
    
    const bookHighlights = highlights.filter(h => h.bookId === book.id);
    
    if (bookHighlights.length === 0) {
        setGeneratedReport("这本书还没有划线内容，快去阅读并记录精彩瞬间吧！");
        setIsGeneratingReport(false);
        return;
    }

    try {
        const prompt = `请为书籍《${book.title}》（作者：${book.author}）生成一份结构化的中文读书报告。
        请严格基于以下用户的划线和笔记生成：
        ${bookHighlights.map(h => `- "${h.text}" (笔记: ${h.note || '无'})`).join('\n')}
        
        报告包含:
        1. 核心观点总结
        2. 用户关注点分析
        3. 深度金句感悟
        `;

        const response = await ai.models.generateContent({
            model: AI_MODEL_FLASH,
            contents: prompt,
        });
        setGeneratedReport(response.text || "生成报告失败");
    } catch (e) {
        console.error(e);
        setGeneratedReport("生成报告时发生错误");
    } finally {
        setIsGeneratingReport(false);
    }
  };

  const toggleMenu = (e: React.MouseEvent, bookId: string) => {
      e.stopPropagation();
      setMenuOpenId(menuOpenId === bookId ? null : bookId);
  };

  // Close menu when clicking outside
  useEffect(() => {
      const closeMenu = () => setMenuOpenId(null);
      window.addEventListener('click', closeMenu);
      return () => window.removeEventListener('click', closeMenu);
  }, []);

  return (
    <div className="p-5 space-y-6 pt-12 min-h-screen bg-gray-50">
        {/* Daily Plans Section - Scrollable for Multiple Plans */}
        {readingBooks.length > 0 && (
            <div className="mb-8">
                <h2 className="text-sm font-bold text-gray-500 mb-3 uppercase tracking-wider flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-indigo-500"/> 今日阅读计划
                </h2>
                <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2 -mx-5 px-5">
                    {readingBooks.map(dailyTaskBook => (
                        <div 
                            key={dailyTaskBook.id}
                            onClick={() => onOpenBook(dailyTaskBook)}
                            className="bg-white rounded-2xl p-4 shadow-lg shadow-indigo-50 border border-indigo-50 flex items-center gap-4 cursor-pointer hover:scale-[1.01] transition-transform active:scale-95 min-w-[85%] sm:min-w-[320px] flex-shrink-0"
                        >
                            <div className={`w-16 h-20 rounded shadow-md bg-gradient-to-br ${dailyTaskBook.coverColor} flex-shrink-0 flex items-center justify-center p-1`}>
                                <div className="text-[9px] text-white font-bold text-center leading-tight">{dailyTaskBook.title}</div>
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-start">
                                    <h3 className="font-bold text-gray-900 mb-1 truncate">{dailyTaskBook.title}</h3>
                                    <span className="bg-indigo-100 text-indigo-700 text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0">进行中</span>
                                </div>
                                <p className="text-xs text-gray-500 mb-3 truncate">第 {dailyTaskBook.currentChapter} / {dailyTaskBook.totalChapters} 章</p>
                                <div className="space-y-1">
                                    <div className="flex justify-between text-[10px] text-gray-400">
                                        <span>进度</span>
                                        <span>{dailyTaskBook.progress}%</span>
                                    </div>
                                    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                        <div className="h-full bg-indigo-500 rounded-full" style={{width: `${dailyTaskBook.progress}%`}}></div>
                                    </div>
                                </div>
                            </div>
                            <div className="bg-indigo-50 p-2 rounded-full text-indigo-600">
                                <Play size={20} fill="currentColor" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )}

        <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-900">我的书架</h1>
            <div className="flex bg-gray-100 p-1 rounded-lg">
                <button onClick={() => setFilter("all")} className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${filter === "all" ? "bg-white shadow-sm text-gray-900" : "text-gray-500"}`}>全部</button>
                <button onClick={() => setFilter("reading")} className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${filter === "reading" ? "bg-white shadow-sm text-gray-900" : "text-gray-500"}`}>在读</button>
            </div>
        </div>

        {/* Compact Grid Layout */}
        <div className="grid grid-cols-3 gap-3 pb-20">
            {displayBooks.map(book => (
                <div key={book.id} className="group relative flex flex-col gap-2">
                    <div 
                        onClick={() => onOpenBook(book)}
                        className={`aspect-[2/3] w-full rounded-md shadow bg-gradient-to-br ${book.coverColor} p-3 flex flex-col justify-between cursor-pointer hover:shadow-lg transition-all transform hover:-translate-y-0.5 relative overflow-hidden`}
                    >
                        {/* Electronic Book Style */}
                        <div className="absolute left-0 top-0 w-full h-full bg-black/10"></div>
                        <div className="absolute left-0.5 top-0 bottom-0 w-[2px] bg-white/20 z-10"></div>
                        
                        <div className="z-10 flex flex-col h-full relative">
                             <h3 className="text-white font-bold text-sm leading-tight line-clamp-3 drop-shadow-md tracking-tight pr-4">{book.title}</h3>
                            <div className="mt-auto">
                                <p className="text-white/80 text-[10px] mb-1.5 font-medium truncate">{book.author}</p>
                                {book.status === "reading" && (
                                    <div className="w-full bg-black/30 rounded-full h-1">
                                        <div className="bg-white/90 h-1 rounded-full shadow-[0_0_5px_rgba(255,255,255,0.5)]" style={{ width: `${book.progress}%` }}></div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* 3-Dot Menu Trigger */}
                    <div className="absolute top-1 right-1 z-20">
                        <button 
                            onClick={(e) => toggleMenu(e, book.id)} 
                            className="p-1.5 rounded-full text-white/70 hover:text-white hover:bg-black/30 transition-colors"
                        >
                            <MoreVertical size={14} />
                        </button>
                        
                        {/* Dropdown Menu */}
                        {menuOpenId === book.id && (
                            <div className="absolute right-0 top-full mt-1 w-36 bg-white rounded-lg shadow-xl border border-gray-100 py-1 z-30 overflow-hidden animate-[scaleIn_0.1s_ease-out] origin-top-right">
                                {book.status !== "reading" ? (
                                    <button 
                                        onClick={(e) => { 
                                            e.stopPropagation(); 
                                            setPlanningBook(book); 
                                            setStartChapterInput(book.currentChapter > 0 ? book.currentChapter.toString() : "1");
                                            setMenuOpenId(null); 
                                        }}
                                        className="w-full px-4 py-2.5 text-left text-xs text-gray-700 hover:bg-indigo-50 flex items-center gap-2"
                                    >
                                        <Play size={14} className="text-indigo-600"/> 制定阅读计划
                                    </button>
                                ) : (
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); onTogglePlan(book.id, false); setMenuOpenId(null); }}
                                        className="w-full px-4 py-2.5 text-left text-xs text-gray-700 hover:bg-orange-50 flex items-center gap-2"
                                    >
                                        <PauseCircle size={14} className="text-orange-500"/> 结束阅读计划
                                    </button>
                                )}
                                <button 
                                    onClick={(e) => { e.stopPropagation(); setSelectedBookForNotes(book); setMenuOpenId(null); }}
                                    className="w-full px-4 py-2.5 text-left text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2 border-t border-gray-100"
                                >
                                    <StickyNote size={14} className="text-blue-500"/> 查看笔记
                                </button>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); generateReport(book); }}
                                    className="w-full px-4 py-2.5 text-left text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                                >
                                    <BrainCircuit size={14} className="text-purple-500"/> 生成读后感
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            ))}
            
            {/* Add Book Placeholder */}
            <div 
                onClick={onGoToDiscover}
                className="aspect-[2/3] rounded-md border-2 border-dashed border-gray-200 flex flex-col items-center justify-center text-gray-400 gap-2 hover:bg-gray-50 hover:border-indigo-300 hover:text-indigo-400 cursor-pointer transition-colors"
            >
                <Plus size={24} />
                <span className="text-xs font-medium">添加书籍</span>
            </div>
        </div>

        {/* Plan Setup Modal */}
        {planningBook && (
            <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
                <div className="bg-white w-full max-w-sm rounded-2xl p-6 shadow-2xl animate-[scaleIn_0.2s_ease-out]">
                    <div className="flex items-start gap-4 mb-6">
                         <div className={`w-12 h-16 rounded shadow-sm bg-gradient-to-br ${planningBook.coverColor} flex-shrink-0`}></div>
                         <div>
                            <h3 className="text-lg font-bold text-gray-900 leading-tight mb-1">制定阅读计划</h3>
                            <p className="text-sm text-gray-500">《{planningBook.title}》</p>
                         </div>
                    </div>
                    
                    <div className="mb-8 bg-gray-50 p-4 rounded-xl border border-gray-100">
                        <label className="block text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">从第几章开始阅读？</label>
                        <div className="flex items-center justify-center gap-3">
                            <button 
                                onClick={() => setStartChapterInput(prev => Math.max(1, parseInt(prev || "1") - 1).toString())}
                                className="w-8 h-8 rounded-full bg-white border border-gray-200 text-gray-600 flex items-center justify-center active:scale-90 transition-transform"
                            >-</button>
                            <div className="flex items-baseline gap-1">
                                <input 
                                    type="number" 
                                    min="1" 
                                    max={planningBook.totalChapters}
                                    value={startChapterInput}
                                    onChange={(e) => setStartChapterInput(e.target.value)}
                                    className="w-16 bg-transparent border-b-2 border-indigo-500 text-center text-2xl font-bold text-indigo-600 focus:outline-none p-1"
                                />
                                <span className="text-sm text-gray-400 font-medium">/ {planningBook.totalChapters} 章</span>
                            </div>
                            <button 
                                onClick={() => setStartChapterInput(prev => Math.min(planningBook.totalChapters, parseInt(prev || "1") + 1).toString())}
                                className="w-8 h-8 rounded-full bg-white border border-gray-200 text-gray-600 flex items-center justify-center active:scale-90 transition-transform"
                            >+</button>
                        </div>
                        {parseInt(startChapterInput) === 1 && (
                            <p className="text-[10px] text-center text-gray-400 mt-2">从头开始阅读</p>
                        )}
                        {parseInt(startChapterInput) > 1 && (
                            <p className="text-[10px] text-center text-orange-400 mt-2">跳过前 {parseInt(startChapterInput) - 1} 章</p>
                        )}
                    </div>

                    <div className="flex gap-3">
                        <button 
                            onClick={() => setPlanningBook(null)}
                            className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-600 font-bold text-sm hover:bg-gray-200 transition-colors"
                        >
                            取消
                        </button>
                        <button 
                            onClick={() => {
                                const ch = parseInt(startChapterInput) || 1;
                                const validCh = Math.min(Math.max(1, ch), planningBook.totalChapters);
                                onTogglePlan(planningBook.id, true, validCh);
                                setPlanningBook(null);
                            }}
                            className="flex-1 py-3 rounded-xl bg-indigo-600 text-white font-bold text-sm shadow-lg shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all"
                        >
                            开始计划
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* Notes Modal */}
        {selectedBookForNotes && (
            <div className="fixed inset-0 z-[100] bg-black/50 flex items-end sm:items-center justify-center p-4 backdrop-blur-sm">
                <div className="bg-white w-full max-w-md rounded-2xl max-h-[80vh] flex flex-col shadow-2xl">
                    <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-2xl">
                        <div className="flex items-center gap-2">
                            <StickyNote size={18} className="text-blue-600" />
                            <h3 className="font-bold text-gray-900">我的笔记 - {selectedBookForNotes.title}</h3>
                        </div>
                        <button onClick={() => setSelectedBookForNotes(null)}><X size={20} className="text-gray-400 hover:text-gray-600" /></button>
                    </div>
                    <div className="p-4 overflow-y-auto flex-1 bg-gray-50/50">
                        {highlights.filter(h => h.bookId === selectedBookForNotes.id).length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-2">
                                <Highlighter size={32} className="opacity-20" />
                                <p className="text-sm">暂无笔记</p>
                                <p className="text-xs text-gray-300">阅读时选中文字即可添加</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {highlights.filter(h => h.bookId === selectedBookForNotes.id).map(h => (
                                    <div key={h.id} className="bg-yellow-50 p-4 rounded-xl border border-yellow-100 shadow-sm relative">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-[10px] font-bold rounded">第 {h.chapter} 章</span>
                                            <span className="text-[10px] text-gray-400">{h.createdAt.split('T')[0]}</span>
                                        </div>
                                        <p className="text-gray-800 text-sm font-serif italic leading-relaxed border-l-2 border-yellow-300 pl-3 mb-2">
                                            {h.text}
                                        </p>
                                        {h.note && (
                                            <div className="bg-white/50 p-2 rounded text-xs text-gray-600 mt-2">
                                                <span className="font-bold text-gray-400 mr-1">思考:</span> {h.note}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}

        {/* Report Modal */}
        {selectedBookForReport && (
            <div className="fixed inset-0 z-[100] bg-black/50 flex items-end sm:items-center justify-center p-4 backdrop-blur-sm">
                <div className="bg-white w-full max-w-md rounded-2xl max-h-[80vh] overflow-hidden flex flex-col shadow-2xl">
                    <div className="p-4 border-b flex justify-between items-center bg-indigo-50">
                        <div className="flex items-center gap-2">
                            <Sparkles size={18} className="text-indigo-600" />
                            <h3 className="font-bold text-indigo-900">AI 读后感报告</h3>
                        </div>
                        <button onClick={() => setSelectedBookForReport(null)}><X size={20} className="text-indigo-400" /></button>
                    </div>
                    <div className="p-6 overflow-y-auto font-serif text-gray-800 leading-relaxed text-sm">
                        {isGeneratingReport ? (
                            <div className="flex flex-col items-center py-8 gap-3 text-gray-500">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                                <p>正在整合您的笔记...</p>
                            </div>
                        ) : (
                            <div className="prose prose-sm prose-indigo">
                                <h4 className="text-lg font-bold mb-4 text-gray-900 border-l-4 border-indigo-500 pl-3">{selectedBookForReport.title}</h4>
                                <div className="whitespace-pre-wrap text-justify">{generatedReport}</div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}
    </div>
  );
};

// --- VIEW: Reader ---

const ReaderView = ({ 
    book, 
    initialFragment,
    fetchFragment,
    onClose, 
    updateBookProgress, 
    highlights, 
    addHighlight, 
    deleteHighlight,
    stats 
}: { 
    book: Book, 
    initialFragment: DailyFragment | null,
    fetchFragment: (b: Book, c: number) => Promise<DailyFragment | null>,
    onClose: () => void, 
    updateBookProgress: (id: string, ch: number, p: number, done: boolean, minutes: number) => void,
    highlights: Highlight[],
    addHighlight: (h: Highlight) => void,
    deleteHighlight: (id: string) => void,
    stats: UserStats
}) => {
  const [dailyFragment, setDailyFragment] = useState<DailyFragment | null>(initialFragment);
  const [isLoading, setIsLoading] = useState(!initialFragment);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showNotesDrawer, setShowNotesDrawer] = useState(false);
  
  // Selection Logic States
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [selectionSource, setSelectionSource] = useState<"content" | "summary" | "quote">("content");
  const [isWritingNote, setIsWritingNote] = useState(false);
  const [noteContent, setNoteContent] = useState("");
  
  // Refs
  const textRef = useRef<HTMLDivElement>(null);

  // Fetch Fragment if not provided via cache
  useEffect(() => {
    if (dailyFragment) return; // Already have data (from cache or previous fetch)

    const loadFragment = async () => {
      setIsLoading(true);
      const fragment = await fetchFragment(book, book.currentChapter);
      if (fragment) {
          setDailyFragment(fragment);
      }
      setIsLoading(false);
    };

    loadFragment();
  }, [book.id, book.currentChapter]); // Only re-fetch if props change and we don't have data

  const handleComplete = () => {
      if (!dailyFragment) return;
      setShowSuccessModal(true);
  };

  const handleModalClose = () => {
      if (!dailyFragment) return;
      const newChapter = dailyFragment.chapter + 1;
      const newProgress = Math.min(100, Math.round((newChapter / book.totalChapters) * 100));
      const isFinished = newChapter > book.totalChapters;
      
      updateBookProgress(
          book.id, 
          newChapter, 
          newProgress, 
          isFinished, 
          dailyFragment.estimatedMinutes // Pass actual minutes to stats
      );
      setShowSuccessModal(false);
      onClose();
  };

  // Generic Text Selection Handler
  const handleTextSelect = (source: "content" | "summary" | "quote") => {
      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) {
          setSelectedText(selection.toString().trim());
          setSelectionSource(source);
          setIsWritingNote(false); // Reset note input when new selection occurs
      } else {
          // Only clear if we aren't actively writing a note
          // We rely on click-outside logic or 'Cancel' button to clear usually
      }
  };
  
  // Clear selection when clicking elsewhere (handled by backdrop of floating menu usually)
  const clearSelection = () => {
      setSelectedText(null);
      setIsWritingNote(false);
      setNoteContent("");
      window.getSelection()?.removeAllRanges();
  };

  const saveHighlight = (withNote: boolean = false) => {
      if (!selectedText || !dailyFragment) return;
      
      const newHighlight: Highlight = {
          id: Date.now().toString(),
          bookId: book.id,
          chapter: dailyFragment.chapter,
          text: selectedText,
          note: withNote ? noteContent : undefined,
          createdAt: new Date().toISOString(),
          sourceSection: selectionSource
      };
      
      addHighlight(newHighlight);
      clearSelection();
      // Optionally show a toast confirmation here
  };

  return (
    <div className="fixed inset-0 bg-[#FDF8F4] z-50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="h-14 border-b border-[#EDE0D4] flex items-center justify-between px-4 bg-[#FDF8F4] shrink-0 z-20">
         <button onClick={onClose} className="text-gray-600 p-2 hover:bg-black/5 rounded-full"><ChevronLeft size={24}/></button>
         <div className="text-center">
             <h2 className="text-sm font-bold text-gray-800 max-w-[150px] truncate">{book.title}</h2>
             <p className="text-[10px] text-gray-500 tracking-widest uppercase">第 {dailyFragment?.chapter || book.currentChapter} 章</p>
         </div>
         <div className="flex items-center gap-1">
             <span className="text-xs font-mono text-indigo-600 mr-2 font-medium">{book.progress}%</span>
             <button onClick={() => setShowNotesDrawer(true)} className="text-gray-600 p-2 hover:bg-black/5 rounded-full relative">
                 <StickyNote size={20} />
                 {highlights.length > 0 && <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full"></span>}
             </button>
         </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full h-1 bg-gray-200 shrink-0">
          <div className="h-full bg-indigo-600 transition-all duration-500" style={{ width: `${book.progress}%`}}></div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6 pb-32 no-scrollbar relative" >
          {isLoading ? (
              <div className="space-y-4 animate-pulse pt-10">
                  <div className="h-32 bg-indigo-50 rounded-xl"></div>
                  <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                  <div className="h-4 bg-gray-200 rounded w-full"></div>
                  <div className="h-4 bg-gray-200 rounded w-5/6"></div>
                  <div className="h-4 bg-gray-200 rounded w-full"></div>
                  <div className="h-4 bg-gray-200 rounded w-full"></div>
                  <div className="h-4 bg-gray-200 rounded w-full"></div>
              </div>
          ) : dailyFragment && (
              <div className="max-w-xl mx-auto space-y-8">
                  
                  {/* AI Summary Card (Selectable) */}
                  <div 
                    className="bg-white p-5 rounded-xl shadow-sm border border-indigo-100 relative overflow-hidden selection:bg-indigo-100 selection:text-indigo-900"
                    onMouseUp={() => handleTextSelect('summary')}
                    onTouchEnd={() => handleTextSelect('summary')}
                  >
                      <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500"></div>
                      <div className="flex items-center gap-2 mb-4 text-indigo-600">
                          <Sparkles size={16} />
                          <span className="text-xs font-bold uppercase tracking-wide">AI 智能导读</span>
                      </div>
                      <div className="space-y-4">
                        <div>
                            <div className="flex items-center gap-1.5 mb-1">
                                <div className="w-1 h-1 bg-gray-300 rounded-full"></div>
                                <p className="text-xs text-gray-400 font-semibold">上文回顾</p>
                            </div>
                            <p className="text-sm text-gray-600 leading-relaxed italic">{dailyFragment.context}</p>
                        </div>
                        <hr className="border-gray-100"/>
                        <div>
                            <div className="flex items-center gap-1.5 mb-1">
                                <div className="w-1 h-1 bg-indigo-400 rounded-full"></div>
                                <p className="text-xs text-gray-400 font-semibold">本章摘要</p>
                            </div>
                            <p className="text-sm text-gray-800 leading-relaxed font-medium text-justify">{dailyFragment.summary}</p>
                        </div>
                        <div className="flex items-center gap-2 text-gray-400 text-xs mt-2 bg-gray-50 p-2 rounded-lg inline-flex">
                            <Clock size={12} />
                            <span>预计阅读 {dailyFragment.estimatedMinutes} 分钟</span>
                        </div>
                      </div>
                  </div>

                  {/* Actual Content (Selectable) */}
                  <div 
                    ref={textRef} 
                    className="font-serif text-lg leading-8 text-gray-800 selection:bg-indigo-100 selection:text-indigo-900 text-justify tracking-wide"
                    onMouseUp={() => handleTextSelect('content')}
                    onTouchEnd={() => handleTextSelect('content')}
                  >
                      {dailyFragment.content.split('\n').map((para, i) => (
                          <p key={i} className="mb-5 indent-8">{para}</p>
                      ))}
                  </div>

                  {/* Golden Sentences (Selectable) */}
                  <div 
                    className="space-y-5 pt-8 border-t border-gray-200 selection:bg-yellow-100 selection:text-yellow-900"
                    onMouseUp={() => handleTextSelect('quote')}
                    onTouchEnd={() => handleTextSelect('quote')}
                  >
                      <h3 className="text-center text-xs font-bold text-gray-400 uppercase tracking-widest">本章金句</h3>
                      {dailyFragment.quotes.map((quote, i) => (
                          <div key={i} className="flex gap-3 items-start">
                              <Quote size={16} className="text-indigo-400 shrink-0 mt-1 transform scale-x-[-1]" />
                              <p className="text-gray-600 text-sm italic font-serif">{quote}</p>
                          </div>
                      ))}
                  </div>
              </div>
          )}
      </div>

      {/* Sticky Bottom Action */}
      {!isLoading && dailyFragment && !selectedText && (
        <div className="absolute bottom-0 w-full bg-white border-t border-gray-100 p-4 shadow-[0_-5px_15px_rgba(0,0,0,0.05)] flex items-center justify-between z-30">
           <div className="text-xs text-gray-400">
               今日任务 <br/> 
               <span className="font-bold text-gray-900 text-sm">{dailyFragment.estimatedMinutes} 分钟</span>
           </div>
           <button 
             onClick={handleComplete}
             className="bg-gray-900 text-white px-8 py-3 rounded-xl font-semibold shadow-lg flex items-center gap-2 hover:scale-105 transition-transform active:scale-95"
           >
               <CheckCircle2 size={18} />
               完成打卡
           </button>
        </div>
      )}

      {/* Floating Selection Action Menu (Bottom Sheet Style) */}
      {selectedText && (
          <div className="absolute bottom-0 inset-x-0 z-[60] animate-[slideUp_0.2s_ease-out]">
              {/* Backdrop to close */}
              <div className="fixed inset-0 bg-black/10 z-[-1]" onClick={clearSelection}></div>
              
              <div className="bg-white rounded-t-2xl shadow-[0_-10px_30px_rgba(0,0,0,0.15)] p-4 border-t border-gray-100">
                  <div className="flex justify-between items-start mb-3">
                      <div className="text-xs text-gray-400 font-bold uppercase tracking-wider">
                          {selectionSource === 'content' ? '正文' : selectionSource === 'summary' ? '导读摘要' : '金句'}已选中
                      </div>
                      <button onClick={clearSelection}><X size={16} className="text-gray-400"/></button>
                  </div>
                  
                  <p className="text-sm text-gray-600 line-clamp-2 italic mb-4 border-l-2 border-indigo-300 pl-2">
                      "{selectedText}"
                  </p>

                  {!isWritingNote ? (
                      <div className="flex gap-3">
                          <button 
                            onClick={() => saveHighlight(false)}
                            className="flex-1 bg-indigo-600 text-white py-3 rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-indigo-700 active:scale-95 transition-transform"
                          >
                              <Highlighter size={18} /> 标记划线
                          </button>
                          <button 
                            onClick={() => setIsWritingNote(true)}
                            className="flex-1 bg-gray-100 text-gray-800 py-3 rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-gray-200 active:scale-95 transition-transform"
                          >
                              <PenLine size={18} /> 写想法
                          </button>
                      </div>
                  ) : (
                      <div className="flex flex-col gap-3">
                          <textarea 
                             className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none"
                             rows={3}
                             placeholder="写下你的思考..."
                             value={noteContent}
                             onChange={(e) => setNoteContent(e.target.value)}
                             autoFocus
                          />
                          <button 
                            onClick={() => saveHighlight(true)}
                            className="w-full bg-indigo-600 text-white py-3 rounded-xl font-medium flex items-center justify-center gap-2"
                          >
                              <Save size={18} /> 保存笔记
                          </button>
                      </div>
                  )}
              </div>
          </div>
      )}

      {/* Notes Drawer (Right Side Push/Overlay) */}
      {showNotesDrawer && (
          <>
              <div className="absolute inset-0 bg-black/20 z-[40] backdrop-blur-[1px] transition-opacity" onClick={() => setShowNotesDrawer(false)}></div>
              <div className="absolute inset-y-0 right-0 w-[85%] max-w-sm bg-white z-[50] shadow-2xl flex flex-col animate-[slideLeft_0.3s_ease-out]">
                  <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/80 backdrop-blur">
                      <h3 className="font-bold text-gray-800 flex items-center gap-2">
                          <StickyNote size={18} className="text-indigo-600"/>
                          我的笔记
                      </h3>
                      <button onClick={() => setShowNotesDrawer(false)} className="p-1 text-gray-400 hover:bg-gray-200 rounded-full"><X size={20}/></button>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto p-4 bg-gray-50/30">
                      {highlights.length === 0 ? (
                           <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-3">
                               <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center">
                                   <Highlighter size={24} className="opacity-30"/>
                               </div>
                               <p className="text-sm">还没有笔记哦</p>
                               <p className="text-xs text-gray-300 text-center px-10">在阅读时选中文字，即可添加划线或想法</p>
                           </div>
                      ) : (
                          <div className="space-y-4">
                              {highlights.slice().reverse().map(h => (
                                  <div key={h.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 group">
                                      <div className="flex justify-between items-start mb-2">
                                          <div className="flex items-center gap-2">
                                              <span className="bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded text-[10px] font-bold">第 {h.chapter} 章</span>
                                              {h.sourceSection && h.sourceSection !== 'content' && (
                                                  <span className="bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded text-[10px]">{h.sourceSection === 'summary' ? '导读' : '金句'}</span>
                                              )}
                                          </div>
                                          <button onClick={() => deleteHighlight(h.id)} className="text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                                              <Trash2 size={14} />
                                          </button>
                                      </div>
                                      <div className="relative pl-3 mb-2">
                                          <div className="absolute left-0 top-1 bottom-1 w-1 bg-yellow-300 rounded-full"></div>
                                          <p className="text-sm text-gray-800 font-serif italic leading-relaxed">{h.text}</p>
                                      </div>
                                      {h.note && (
                                          <div className="mt-3 pt-3 border-t border-gray-50 flex items-start gap-2">
                                              <PenLine size={12} className="text-gray-400 mt-0.5 shrink-0"/>
                                              <p className="text-xs text-gray-600">{h.note}</p>
                                          </div>
                                      )}
                                      <div className="mt-2 text-[10px] text-gray-300 text-right">
                                          {new Date(h.createdAt).toLocaleDateString()}
                                      </div>
                                  </div>
                              ))}
                          </div>
                      )}
                  </div>
              </div>
          </>
      )}

      {/* Success Modal */}
      {showSuccessModal && (
          <div className="absolute inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
              <div className="bg-white rounded-3xl p-6 w-full max-w-sm flex flex-col items-center shadow-2xl animate-[scaleIn_0.3s_ease-out]">
                  <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center mb-4 animate-bounce">
                      <Trophy size={40} className="text-yellow-500" />
                  </div>
                  <h3 className="text-2xl font-black text-gray-900 mb-2">打卡成功!</h3>
                  <p className="text-gray-500 text-center mb-6">你已经完成了今日的阅读任务，离读完这本书又近了一步。</p>
                  
                  <div className="flex gap-4 w-full mb-6">
                      <div className="flex-1 bg-gray-50 rounded-xl p-3 text-center border border-gray-100">
                          <div className="text-xs text-gray-400 mb-1">坚持天数</div>
                          <div className="text-xl font-bold text-gray-900 flex items-center justify-center gap-1">
                              <Flame size={18} className="text-orange-500" fill="currentColor"/>
                              {stats.dailyStreak + 1}
                          </div>
                      </div>
                      <div className="flex-1 bg-gray-50 rounded-xl p-3 text-center border border-gray-100">
                          <div className="text-xs text-gray-400 mb-1">今日阅读</div>
                          <div className="text-xl font-bold text-gray-900">
                             +{dailyFragment?.estimatedMinutes} <span className="text-xs font-normal">分钟</span>
                          </div>
                      </div>
                  </div>

                  <button 
                      onClick={handleModalClose}
                      className="w-full bg-indigo-600 text-white py-3.5 rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all flex items-center justify-center gap-2"
                  >
                      继续努力 <ArrowRight size={18}/>
                  </button>
              </div>
          </div>
      )}
    </div>
  );
};

// --- VIEW: Stats ---

const StatsView = ({ stats }: { stats: UserStats }) => {
  const [viewMode, setViewMode] = useState<"week" | "month">("week");
  
  // Calculate total check-in days from history
  const totalCheckinDays = Object.keys(stats.readingHistory).filter(date => stats.readingHistory[date] > 0).length;

  // Helpers for Calendar Generation
  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay(); // 0 = Sun
  
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth(); // 0-indexed

  const renderMonthCalendar = () => {
      const daysInMonth = getDaysInMonth(currentYear, currentMonth);
      const startDay = getFirstDayOfMonth(currentYear, currentMonth); // 0-6
      
      // Adjust for Monday start if preferred, but Sunday start is standard for grids usually
      // Let's stick to standard: Sun Mon Tue Wed Thu Fri Sat
      const daysArray = Array.from({length: daysInMonth}, (_, i) => i + 1);
      const blanks = Array.from({length: startDay}, (_, i) => i);

      return (
          <div className="grid grid-cols-7 gap-2 text-center text-sm mb-2">
              {['日', '一', '二', '三', '四', '五', '六'].map(d => (
                  <div key={d} className="text-xs text-gray-400 py-2">{d}</div>
              ))}
              {blanks.map(b => <div key={`blank-${b}`}></div>)}
              {daysArray.map(day => {
                  // Construct YYYY-MM-DD
                  const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const minutes = stats.readingHistory[dateStr] || 0;
                  const isToday = day === today.getDate();

                  return (
                      <div key={day} className="aspect-square flex flex-col items-center justify-center relative">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium z-10
                              ${isToday ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-700'}
                              ${minutes > 0 && !isToday ? 'bg-orange-100 text-orange-800 font-bold' : ''}
                          `}>
                              {day}
                          </div>
                          {minutes > 0 && (
                              <div className="absolute bottom-0.5 w-1 h-1 rounded-full bg-orange-500"></div>
                          )}
                      </div>
                  )
              })}
          </div>
      );
  };

  const renderWeekChart = () => {
      // Generate last 7 days or current week (Mon-Sun)
      // Let's do "Current Week" logic (Mon-Sun)
      const curr = new Date();
      const day = curr.getDay();
      const diff = curr.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
      const monday = new Date(curr.setDate(diff));
      
      const weekDays = [];
      for (let i = 0; i < 7; i++) {
          const d = new Date(monday);
          d.setDate(monday.getDate() + i);
          weekDays.push(d);
      }

      // Default max to 60 if no data, to avoid division by zero or flat graph issues
      const maxVal = Math.max(...weekDays.map(d => stats.readingHistory[d.toISOString().split('T')[0]] || 0), 60);

      return (
          <div className="flex items-end justify-between h-40 pt-4 gap-2">
              {weekDays.map((d, i) => {
                  const dateStr = d.toISOString().split('T')[0];
                  const mins = stats.readingHistory[dateStr] || 0;
                  const isToday = dateStr === new Date().toISOString().split('T')[0];
                  const height = Math.max(5, (mins / maxVal) * 100); // min 5% height
                  const dayLabel = ['一', '二', '三', '四', '五', '六', '日'][i];

                  return (
                      <div key={i} className="flex flex-col items-center gap-2 flex-1 h-full justify-end group">
                          <div className="relative w-full flex flex-col justify-end items-center h-full">
                                {mins > 0 && (
                                     <div className="absolute -top-6 text-[10px] font-bold text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">{mins}m</div>
                                )}
                                <div 
                                    className={`w-full max-w-[30px] rounded-t-lg transition-all duration-700 ease-out ${isToday ? 'bg-indigo-500' : mins > 0 ? 'bg-orange-300' : 'bg-gray-100'}`}
                                    style={{ height: `${height}%` }}
                                ></div>
                          </div>
                          <span className={`text-xs font-medium ${isToday ? 'text-indigo-600' : 'text-gray-400'}`}>{dayLabel}</span>
                      </div>
                  )
              })}
          </div>
      )
  };

  return (
    <div className="p-6 space-y-6 pt-12">
        <h1 className="text-2xl font-bold text-gray-900">阅读统计</h1>

        {/* Header Stats Cards */}
        <div className="grid grid-cols-3 gap-3">
             <div className="bg-white p-3 py-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
                <div className="bg-orange-100 p-2 rounded-full text-orange-600 mb-2">
                    <CalendarIcon size={18} />
                </div>
                <div className="text-2xl font-black text-gray-900 leading-none mb-1">{totalCheckinDays}</div>
                <div className="text-[10px] text-gray-400">累计打卡(天)</div>
             </div>
             <div className="bg-white p-3 py-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
                <div className="bg-blue-100 p-2 rounded-full text-blue-600 mb-2">
                    <Clock size={18} />
                </div>
                <div className="text-2xl font-black text-gray-900 leading-none mb-1">{(stats.totalMinutesRead / 60).toFixed(1)}</div>
                <div className="text-[10px] text-gray-400">总时长(小时)</div>
             </div>
             <div className="bg-white p-3 py-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center text-center">
                <div className="bg-red-100 p-2 rounded-full text-red-600 mb-2">
                    <Flame size={18} fill="currentColor"/>
                </div>
                <div className="text-2xl font-black text-gray-900 leading-none mb-1">{stats.dailyStreak}</div>
                <div className="text-[10px] text-gray-400">连续坚持(天)</div>
             </div>
        </div>

        {/* Main Chart/Calendar Section */}
        <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 min-h-[300px]">
            <div className="flex items-center justify-between mb-6">
                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                    <BarChart3 size={18} className="text-indigo-500"/>
                    阅读记录
                </h3>
                <div className="bg-gray-100 p-1 rounded-lg flex">
                    <button 
                        onClick={() => setViewMode("week")} 
                        className={`text-xs px-3 py-1.5 rounded-md font-medium transition-all ${viewMode === 'week' ? 'bg-white shadow text-gray-900' : 'text-gray-400'}`}
                    >
                        周视图
                    </button>
                    <button 
                        onClick={() => setViewMode("month")} 
                        className={`text-xs px-3 py-1.5 rounded-md font-medium transition-all ${viewMode === 'month' ? 'bg-white shadow text-gray-900' : 'text-gray-400'}`}
                    >
                        月视图
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="animate-[fadeIn_0.3s_ease-out]">
                {viewMode === "week" ? (
                    <div>
                        <p className="text-xs text-gray-400 mb-2">本周阅读时长 (分钟)</p>
                        {renderWeekChart()}
                    </div>
                ) : (
                    <div>
                        <div className="flex justify-between items-center mb-4 px-2">
                            <span className="text-sm font-bold text-gray-800">{currentYear}年 {currentMonth + 1}月</span>
                            <div className="text-[10px] text-gray-400 flex gap-3">
                                <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-orange-100 border border-orange-200"></div> 已打卡</span>
                                <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-indigo-600"></div> 今天</span>
                            </div>
                        </div>
                        {renderMonthCalendar()}
                    </div>
                )}
            </div>
        </div>
    </div>
  );
};


// --- Utilities ---
function getRandomCoverGradient() {
    const gradients = [
        "from-rose-800 to-red-900",
        "from-sky-700 to-blue-900",
        "from-violet-800 to-purple-900",
        "from-emerald-700 to-green-900",
        "from-amber-700 to-orange-900",
        "from-fuchsia-800 to-pink-900",
        "from-slate-700 to-slate-900",
        "from-indigo-800 to-blue-950"
    ];
    return gradients[Math.floor(Math.random() * gradients.length)];
}

// --- Render ---

const root = createRoot(document.getElementById("root")!);
root.render(<App />);