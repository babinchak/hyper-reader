import { EnvVarWarning } from "@/components/env-var-warning";
import { AuthButton } from "@/components/auth-button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { UploadBookForm } from "@/components/upload-book-form";
import { BooksList } from "@/components/books-list";
import { hasEnvVars } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Suspense } from "react";
import { BookOpen } from "lucide-react";

async function HomeContent() {
  if (!hasEnvVars) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <BookOpen className="h-16 w-16 text-muted-foreground" />
        <h1 className="text-4xl font-bold">Hyper Reader</h1>
        <p className="text-lg text-muted-foreground max-w-md">
          Your personal EPUB and PDF library. Upload and read your books in one place.
        </p>
        <Suspense>
          <AuthButton />
        </Suspense>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    // User is logged in - show upload form and books list
    return (
      <div className="w-full max-w-2xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">My Library</h1>
          <p className="text-muted-foreground">
            Upload EPUB or PDF books to your personal library
          </p>
        </div>
        <UploadBookForm />
        <BooksList />
      </div>
    );
  }

  // User is not logged in - show landing page
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <BookOpen className="h-16 w-16 text-muted-foreground" />
      <h1 className="text-4xl font-bold">Hyper Reader</h1>
      <p className="text-lg text-muted-foreground max-w-md">
        Your personal EPUB and PDF library. Upload and read your books in one place.
      </p>
      <Suspense>
        <AuthButton />
      </Suspense>
    </div>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="flex-1 w-full flex flex-col gap-20 items-center">
        <nav className="w-full flex justify-center border-b border-b-foreground/10 h-16">
          <div className="w-full max-w-5xl flex justify-between items-center p-3 px-5 text-sm">
            <div className="flex gap-5 items-center font-semibold">
              <Link href={"/"} className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Hyper Reader
              </Link>
            </div>
            {!hasEnvVars ? (
              <EnvVarWarning />
            ) : (
              <Suspense>
                <AuthButton />
              </Suspense>
            )}
          </div>
        </nav>
        <div className="flex-1 flex flex-col gap-12 max-w-5xl p-5 items-center justify-center">
          <Suspense>
            <HomeContent />
          </Suspense>
        </div>

        <footer className="w-full flex items-center justify-center border-t mx-auto text-center text-xs gap-8 py-16">
          <ThemeSwitcher />
        </footer>
      </div>
    </main>
  );
}
