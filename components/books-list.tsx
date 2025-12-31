import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpen, User, Calendar, FileText } from "lucide-react";
import Link from "next/link";

export async function BooksList() {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return null;
  }

  // First, get the book_ids for this user from user_books
  const { data: userBookLinks, error: linksError } = await supabase
    .from("user_books")
    .select("book_id")
    .eq("user_id", user.id);

  if (linksError) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Your Books
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <p className="text-sm text-red-600 dark:text-red-400">
            Error loading books: {linksError.message}
          </p>
        </CardContent>
      </Card>
    );
  }

  // If no book links, show empty state
  if (!userBookLinks || userBookLinks.length === 0) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Your Books
          </CardTitle>
          <CardDescription>
            Books you've uploaded or added to your library
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">
            No books yet. Upload your first EPUB book to get started!
          </p>
        </CardContent>
      </Card>
    );
  }

  // Fetch the actual books using the book_ids
  const bookIds = userBookLinks.map((link) => link.book_id);
  const { data: books, error: booksError } = await supabase
    .from("books")
    .select("id, title, author, file_size, file_name, created_at, readium_manifest_path")
    .in("id", bookIds)
    .order("created_at", { ascending: false });

  if (booksError) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Your Books
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <p className="text-sm text-red-600 dark:text-red-400">
            Error loading books: {booksError.message}
          </p>
        </CardContent>
      </Card>
    );
  }

  // Transform the data
  const userBooks = (books || []).map((book) => ({
    id: book.id,
    title: book.title,
    author: book.author,
    fileSize: book.file_size,
    fileName: book.file_name,
    createdAt: book.created_at,
    manifestPath: book.readium_manifest_path,
  }));

  if (userBooks.length === 0) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Your Books
          </CardTitle>
          <CardDescription>
            Books you've uploaded or added to your library
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">
            No books found. This might be a data consistency issue.
          </p>
        </CardContent>
      </Card>
    );
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          Your Books ({userBooks.length})
        </CardTitle>
        <CardDescription>
          Books you've uploaded or added to your library
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {userBooks.map((book) => (
            <Link
              key={book.id}
              href={book.manifestPath ? `/read/${book.id}` : "#"}
              className={`flex items-start gap-4 p-4 rounded-lg border bg-card transition-colors ${
                book.manifestPath 
                  ? "hover:bg-accent/50 cursor-pointer" 
                  : "opacity-50 cursor-not-allowed"
              }`}
            >
              <div className="flex-shrink-0">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <BookOpen className="h-6 w-6 text-primary" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-lg mb-1 truncate">
                  {book.title}
                </h3>
                {book.author && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                    <User className="h-4 w-4" />
                    <span className="truncate">{book.author}</span>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                  {book.fileName && (
                    <div className="flex items-center gap-1">
                      <FileText className="h-3 w-3" />
                      <span className="truncate max-w-[200px]">{book.fileName}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1">
                    <span>{formatFileSize(book.fileSize)}</span>
                  </div>
                  {book.createdAt && (
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      <span>Added {formatDate(book.createdAt)}</span>
                    </div>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
