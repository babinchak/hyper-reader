import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { BookReader } from "@/components/book-reader";
import { PdfReader } from "@/components/pdf-reader";

interface PageProps {
  params: Promise<{ bookId: string }>;
}

export default async function ReadBookPage({ params }: PageProps) {
  const { bookId } = await params;
  const supabase = await createClient();

  // Get authenticated user
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    redirect("/auth/login");
  }

  // Fetch the book to get user_id and verify access
  const { data: book, error: bookError } = await supabase
    .from("books")
    .select("id, uploaded_by, book_type, storage_path, file_name, title")
    .eq("id", bookId)
    .single();

  if (bookError || !book) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Book Not Found</h1>
          <p className="text-muted-foreground">The book you're looking for doesn't exist.</p>
        </div>
      </div>
    );
  }

  // Verify user has access to this book
  const { data: userBook } = await supabase
    .from("user_books")
    .select("id")
    .eq("user_id", user.id)
    .eq("book_id", bookId)
    .single();

  if (!userBook) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-muted-foreground">You don't have access to this book.</p>
        </div>
      </div>
    );
  }

  const bookType = book.book_type || "epub";

  if (bookType === "pdf") {
    if (!book.storage_path) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-2">PDF Not Found</h1>
            <p className="text-muted-foreground">The PDF file path is missing.</p>
          </div>
        </div>
      );
    }

    const { data: signedUrl, error: signedError } = await supabase.storage
      .from("pdfs")
      .createSignedUrl(book.storage_path, 60 * 10);

    if (signedError || !signedUrl?.signedUrl) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-2">PDF Not Found</h1>
            <p className="text-muted-foreground">The PDF could not be loaded.</p>
          </div>
        </div>
      );
    }

    return <PdfReader pdfUrl={signedUrl.signedUrl} fileName={book.file_name || book.title} />;
  }

  // Construct the manifest path: books_{user_id}_{book_id}/manifest.json
  const manifestPath = `books_${book.uploaded_by}_${book.id}/manifest.json`;

  // Fetch the manifest from readium-manifests bucket
  const { data: manifestData, error: manifestError } = await supabase.storage
    .from("readium-manifests")
    .download(manifestPath);

  if (manifestError || !manifestData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Manifest Not Found</h1>
          <p className="text-muted-foreground">
            The book manifest could not be loaded. The book may still be processing.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Path: {manifestPath}
          </p>
        </div>
      </div>
    );
  }

  // Parse the manifest JSON
  const manifestText = await manifestData.text();
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (parseError) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Invalid Manifest</h1>
          <p className="text-muted-foreground">The book manifest is invalid or corrupted.</p>
        </div>
      </div>
    );
  }

  // Extract the self href from the manifest, or construct it if missing
  const selfLink = manifest.links?.find(
    (link: any) => link.rel === "self"
  );
  let selfHref = selfLink?.href || "";
  
  // If selfHref is missing or relative, construct the full URL
  if (!selfHref || !selfHref.startsWith("http")) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    selfHref = `${supabaseUrl}/storage/v1/object/public/readium-manifests/${manifestPath}`;
  }

  return <BookReader rawManifest={manifest} selfHref={selfHref} />;
}
