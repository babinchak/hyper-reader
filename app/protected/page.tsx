import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UploadBookForm } from "@/components/upload-book-form";

export default async function ProtectedPage() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/login");
  }

  return (
    <div className="flex-1 w-full flex flex-col gap-12 items-center">
      <div className="w-full max-w-2xl">
        <h1 className="text-3xl font-bold mb-2">My Library</h1>
        <p className="text-muted-foreground mb-8">
          Upload EPUB books to your personal library
        </p>
        <UploadBookForm />
      </div>
    </div>
  );
}
