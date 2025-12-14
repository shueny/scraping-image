import React, { useState, useCallback } from 'react';
import { Download, Play, Image as ImageIcon, Trash2, FileText, CheckCircle, AlertCircle, Loader2, Link as LinkIcon, Server } from 'lucide-react';
import JSZip from 'jszip';
import saveAs from 'file-saver';
import { scrapeUrl, isValidUrl } from './utils/scraper';
import { summarizePropertyListing } from './services/gemini';
import { ScrapedData, ProcessingStatus } from './types';
import { Button } from './components/Button';

const App: React.FC = () => {
  const [inputUrls, setInputUrls] = useState<string>('');
  const [scrapedData, setScrapedData] = useState<ScrapedData[]>([]);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus[]>([]);
  const [isScraping, setIsScraping] = useState(false);
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [generatingSummaryFor, setGeneratingSummaryFor] = useState<string | null>(null);

  // Handle URL input
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputUrls(e.target.value);
  };

  // Start scraping
  const handleScrape = async () => {
    const urls = inputUrls
      .split('\n')
      .map(u => u.trim())
      .filter(u => u.length > 0 && isValidUrl(u));

    if (urls.length === 0) {
      alert('Please enter valid URLs.');
      return;
    }

    setIsScraping(true);
    setScrapedData([]);
    setProcessingStatus(urls.map(url => ({ url, status: 'loading' })));

    // Process sequentially (could be parallel)
    const promises = urls.map(async (url) => {
      try {
        const data = await scrapeUrl(url);
        setProcessingStatus(prev => prev.map(p => 
          p.url === url 
            ? { url, status: data.error ? 'error' : 'success', message: data.error } 
            : p
        ));
        return data;
      } catch (e) {
        setProcessingStatus(prev => prev.map(p => 
          p.url === url ? { url, status: 'error', message: 'Failed to process' } : p
        ));
        return null;
      }
    });

    const data = await Promise.all(promises);
    setScrapedData(data.filter((d): d is ScrapedData => d !== null));
    setIsScraping(false);
  };

  // Generate Summary using Gemini
  const handleSummarize = async (url: string, text: string) => {
    if (!text) return;
    setGeneratingSummaryFor(url);
    try {
      const summary = await summarizePropertyListing(text);
      setSummaries(prev => ({ ...prev, [url]: summary }));
    } catch (e) {
      console.error(e);
      alert('Failed to generate summary');
    } finally {
      setGeneratingSummaryFor(null);
    }
  };

  // Download all images for a specific property
  const handleDownloadImages = async (data: ScrapedData) => {
    if (data.images.length === 0) return;

    const zip = new JSZip();
    const folder = zip.folder("images");
    
    // Fetch images and add to zip
    const fetchPromises = data.images.map(async (imgUrl, index) => {
      try {
        // Use proxy for download to avoid CORS
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(imgUrl)}`;
        const response = await fetch(proxyUrl);
        const blob = await response.blob();
        
        let ext = 'jpg';
        if (imgUrl.includes('.png')) ext = 'png';
        if (imgUrl.includes('.webp')) ext = 'webp';
        
        folder?.file(`image_${index + 1}.${ext}`, blob);
      } catch (e) {
        console.warn('Failed to download image', imgUrl);
      }
    });

    await Promise.all(fetchPromises);
    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, `${data.title.substring(0, 20).replace(/[^a-z0-9]/gi, '_')}_images.zip`);
  };

  const clearAll = () => {
    setScrapedData([]);
    setInputUrls('');
    setProcessingStatus([]);
    setSummaries({});
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg text-white">
              <ImageIcon size={20} />
            </div>
            <h1 className="text-xl font-bold text-slate-900">PropScraper</h1>
          </div>
          <div className="flex items-center gap-4">
             <span className="text-xs text-slate-500 hidden sm:inline-block">Powered by Gemini 2.5</span>
            <div className="flex items-center gap-1 px-2 py-1 bg-slate-100 rounded text-xs text-slate-600" title="To enable Playwright: npm install && node server.cjs">
                <Server size={12} />
                <span className="hidden sm:inline">Advanced Mode Available</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Input Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
              <label htmlFor="urls" className="block text-sm font-semibold text-slate-700 mb-2">
                Property URLs
              </label>
              <p className="text-xs text-slate-500 mb-3">Paste one URL per line.</p>
              <textarea
                id="urls"
                className="w-full h-64 p-3 text-sm text-slate-700 border-slate-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 bg-slate-50 font-mono resize-none border"
                placeholder="https://www.property24.co.ke/..."
                value={inputUrls}
                onChange={handleInputChange}
                disabled={isScraping}
              ></textarea>
              
              <div className="mt-4 flex gap-2">
                <Button 
                  onClick={handleScrape} 
                  isLoading={isScraping} 
                  className="w-full"
                  icon={<Play size={16} />}
                >
                  Extract Images
                </Button>
                <Button 
                  variant="secondary" 
                  onClick={clearAll}
                  disabled={isScraping || (!inputUrls && scrapedData.length === 0)}
                  icon={<Trash2 size={16} />}
                >
                  Clear
                </Button>
              </div>

              {/* Local Server Instruction */}
              <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
                <h4 className="flex items-center gap-2 text-xs font-bold text-blue-800 mb-1">
                   <Server size={12} /> Enable Playwright (Optional)
                </h4>
                <p className="text-[10px] text-blue-700 leading-tight">
                  For best results with Property24, run the local server:
                  <code className="block bg-white/50 p-1 mt-1 rounded font-mono">node server.cjs</code>
                  App will automatically connect if running.
                </p>
              </div>
            </div>

            {/* Status Panel */}
            {processingStatus.length > 0 && (
              <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Processing Queue</h3>
                <div className="space-y-3 max-h-64 overflow-y-auto">
                  {processingStatus.map((status, idx) => (
                    <div key={idx} className="flex items-center gap-3 text-sm">
                      {status.status === 'loading' && <Loader2 size={16} className="text-blue-500 animate-spin flex-shrink-0" />}
                      {status.status === 'success' && <CheckCircle size={16} className="text-green-500 flex-shrink-0" />}
                      {status.status === 'error' && <AlertCircle size={16} className="text-red-500 flex-shrink-0" />}
                      <span className="truncate flex-1 text-slate-600">{status.url}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Results Section */}
          <div className="lg:col-span-2 space-y-8">
            {scrapedData.length === 0 && !isScraping && (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 min-h-[400px] border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                <ImageIcon size={48} className="mb-4 opacity-50" />
                <p className="text-lg font-medium">No images extracted yet</p>
                <p className="text-sm">Enter URLs on the left to get started</p>
              </div>
            )}

            {scrapedData.map((data, idx) => (
              <div key={idx} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg font-bold text-slate-900 truncate" title={data.title}>
                      {data.title}
                    </h2>
                    <a href={data.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 hover:underline mt-1 truncate">
                      <LinkIcon size={12} />
                      {data.url}
                    </a>
                    {data.price && (
                       <span className="inline-block mt-2 px-2 py-0.5 bg-green-100 text-green-700 text-xs font-semibold rounded">
                         {data.price}
                       </span>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button 
                      variant="secondary" 
                      size="sm" 
                      className="text-xs"
                      onClick={() => handleSummarize(data.url, data.text)}
                      isLoading={generatingSummaryFor === data.url}
                      icon={<FileText size={14} />}
                    >
                      AI Summary
                    </Button>
                    <Button 
                      size="sm" 
                      className="text-xs"
                      onClick={() => handleDownloadImages(data)}
                      disabled={data.images.length === 0}
                      icon={<Download size={14} />}
                    >
                      Download All ({data.images.length})
                    </Button>
                  </div>
                </div>

                {/* AI Summary Section */}
                {summaries[data.url] && (
                  <div className="px-6 py-4 bg-blue-50 border-b border-blue-100">
                    <div className="flex items-start gap-3">
                       <div className="mt-1 bg-blue-600 p-1 rounded-full">
                          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M21.71 8.71c1.25-1.25.68-2.71 0-3.42l-3-3c-1.26-1.25-2.71-.68-3.42 0L13.59 4H11C7.13 4 4 7.13 4 11c0 .5.09 1.01.28 1.5H2.35c-.55 0-1 .45-1 1s.45 1 1 1h2.32c.57 2.08 1.99 3.82 3.85 4.85l-1.93 1.93c-.39.39-.39 1.02 0 1.41.39.39 1.02.39 1.41 0l1.93-1.93c1.94 1.08 4.22 1.34 6.45.64l2.29 2.29c.39.39 1.02.39 1.41 0 .39-.39.39-1.02 0-1.41l-2.29-2.29c.7-2.23.44-4.51-.64-6.45l2.57-2.57zM11 13c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>
                       </div>
                       <div>
                          <h4 className="text-xs font-bold text-blue-800 uppercase tracking-wider mb-1">Gemini Analysis</h4>
                          <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
                            {summaries[data.url]}
                          </div>
                       </div>
                    </div>
                  </div>
                )}

                {/* Error State */}
                {data.error && (
                   <div className="p-6 text-center text-red-600 bg-red-50">
                     <p>Failed to extract content: {data.error}</p>
                   </div>
                )}

                {/* Image Grid */}
                {data.images.length > 0 ? (
                  <div className="p-6 bg-slate-50/50">
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                      {data.images.map((img, i) => (
                        <div key={i} className="group relative aspect-square bg-slate-200 rounded-lg overflow-hidden border border-slate-200">
                          <img 
                            src={img} 
                            alt={`Extracted ${i}`} 
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                            loading="lazy"
                            onError={(e) => {
                                // Hide broken images
                                (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                            <a 
                              href={img} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="p-2 bg-white/90 rounded-full hover:bg-white text-slate-900 transition-colors shadow-lg"
                              title="View Full Size"
                            >
                              <ImageIcon size={18} />
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  !data.error && (
                    <div className="p-8 text-center text-slate-500">
                      No suitable images found on this page.
                    </div>
                  )
                )}
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;