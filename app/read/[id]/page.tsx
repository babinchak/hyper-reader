import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BookReader } from "@/components/book-reader";

export default async function ReadBookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect("/auth/login");
  }

  // Fetch the book to get the manifest path
  const { data: book, error: bookError } = await supabase
    .from("books")
    .select("id, title, readium_manifest_path")
    .eq("id", id)
    .single();

  if (bookError || !book) {
    redirect("/");
  }

  // Check if user has access to this book
  const { data: userBook } = await supabase
    .from("user_books")
    .select("id")
    .eq("user_id", user.id)
    .eq("book_id", id)
    .single();

  if (!userBook) {
    redirect("/");
  }

  if (!book.readium_manifest_path) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Manifest Not Found</h1>
          <p className="text-muted-foreground mb-4">
            This book doesn't have a manifest path configured.
          </p>
          <a href="/" className="text-primary hover:underline">
            Return to library
          </a>
        </div>
      </div>
    );
  }

  return <BookReader bookId={id} manifestPath={book.readium_manifest_path} title={book.title} />;
}
