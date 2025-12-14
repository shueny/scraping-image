export interface ScrapedData {
  url: string;
  images: string[];
  text: string;
  title: string;
  price?: string;
  error?: string;
}

export interface ProcessingStatus {
  url: string;
  status: 'idle' | 'loading' | 'success' | 'error';
  message?: string;
}

export interface SummaryResult {
  url: string;
  summary: string;
}
