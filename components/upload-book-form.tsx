'use client'

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Upload, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

export function UploadBookForm() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setUploading(true);
    setMessage(null);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/books/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      setMessage(data.duplicate 
        ? `Book already exists: ${data.message}`
        : `Success: ${data.message}`
      );
      
      setFile(null);
      const fileInput = document.getElementById('book-file') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Upload Book</CardTitle>
        <CardDescription>
          Upload an EPUB or PDF file to add it to your library. Duplicate books will be automatically detected.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="book-file" className="text-sm font-medium">
              Select EPUB or PDF File
            </label>
            <Input
              id="book-file"
              type="file"
              accept=".epub,.pdf,application/epub+zip,application/pdf"
              onChange={(e) => {
                const selectedFile = e.target.files?.[0] || null;
                setFile(selectedFile);
                setMessage(null);
                setError(null);
              }}
              disabled={uploading}
              className="cursor-pointer"
            />
            {file && (
              <p className="text-sm text-muted-foreground">
                Selected: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
              </p>
            )}
          </div>
          
          <Button 
            type="submit" 
            disabled={!file || uploading}
            className="w-full"
          >
            {uploading ? (
              <>
                <Loader2 className="animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload />
                Upload Book
              </>
            )}
          </Button>

          {message && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-200">
              <CheckCircle2 className="h-4 w-4" />
              <p className="text-sm">{message}</p>
            </div>
          )}
          
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200">
              <XCircle className="h-4 w-4" />
              <p className="text-sm">{error}</p>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
