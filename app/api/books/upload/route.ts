import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  console.log("[UPLOAD] Request received");
  
  try {
    const supabase = await createClient();
    console.log("[UPLOAD] Supabase client created");
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.log("[UPLOAD] Auth error:", authError);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.log("[UPLOAD] User authenticated:", user.id);

    // Get file from form data
    const formData = await request.formData();
    const file = formData.get("file") as File;
    
    if (!file) {
      console.log("[UPLOAD] No file provided");
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    console.log("[UPLOAD] File received:", file.name, file.size, "bytes");

    // Validate file type
    if (file.type !== "application/epub+zip" && !file.name.toLowerCase().endsWith(".epub")) {
      console.log("[UPLOAD] Invalid file type:", file.type);
      return NextResponse.json({ error: "Invalid file type. Expected EPUB file." }, { status: 400 });
    }

    // Calculate SHA256 hash
    console.log("[UPLOAD] Calculating SHA256 hash...");
    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    console.log("[UPLOAD] Hash calculated:", hashHex.substring(0, 16) + "...");
    
    // Check for duplicate by SHA256
    console.log("[UPLOAD] Checking for duplicates...");
    const { data: existingBook, error: checkError } = await supabase
      .from("books")
      .select("id, title")
      .eq("file_checksum", hashHex)
      .single();
    
    if (checkError && checkError.code !== "PGRST116") { // PGRST116 = no rows returned
      console.error("[UPLOAD] Database error checking duplicates:", checkError);
      return NextResponse.json({ 
        error: "Database error", 
        details: checkError.message 
      }, { status: 500 });
    }

    // If duplicate exists, link to user_books
    if (existingBook) {
      console.log("[UPLOAD] Duplicate found:", existingBook.id);
      // Check if user already has access
      const { data: existingLink } = await supabase
        .from("user_books")
        .select("id")
        .eq("user_id", user.id)
        .eq("book_id", existingBook.id)
        .single();
      
      // Link if not already linked
      if (!existingLink) {
        const { error: linkError } = await supabase
          .from("user_books")
          .insert({
            user_id: user.id,
            book_id: existingBook.id,
          });
        
        if (linkError) {
          console.error("[UPLOAD] Error linking duplicate book:", linkError);
          return NextResponse.json({ 
            error: "Failed to link book to user",
            details: linkError.message 
          }, { status: 500 });
        }
      }
      
      return NextResponse.json({ 
        book_id: existingBook.id,
        duplicate: true,
        message: "Book already exists and has been added to your library"
      });
    }

    // Not a duplicate - create new book
    console.log("[UPLOAD] Creating new book record...");
    const bookId = crypto.randomUUID();
    const storagePath = `books/${user.id}/${bookId}.epub`;
    
    // Create book record
    const bookData = {
      id: bookId,
      title: file.name.replace(/\.epub$/i, ""),
      file_size: file.size,
      file_checksum: hashHex,
      uploaded_by: user.id,
      storage_path: storagePath,
      file_name: file.name,
    };
    
    console.log("[UPLOAD] Inserting book with data:", {
      id: bookId,
      title: bookData.title,
      file_size: bookData.file_size,
      has_checksum: !!bookData.file_checksum,
      uploaded_by: bookData.uploaded_by,
      storage_path: bookData.storage_path,
      file_name: bookData.file_name,
    });
    
    const { error: bookError } = await supabase
      .from("books")
      .insert(bookData);

    if (bookError) {
      console.error("[UPLOAD] Error creating book record:", {
        message: bookError.message,
        code: bookError.code,
        details: bookError.details,
        hint: bookError.hint,
      });
      
      // Handle unique constraint violation (duplicate checksum)
      // This can happen in race conditions where two uploads happen simultaneously
      if (bookError.code === "23505") { // PostgreSQL unique violation
        console.log("[UPLOAD] Duplicate checksum detected (race condition), checking for existing book...");
        
        // Re-check for the book (it might have been created by another request)
        const { data: raceConditionBook } = await supabase
          .from("books")
          .select("id, title")
          .eq("file_checksum", hashHex)
          .single();
        
        if (raceConditionBook) {
          // Link to user_books
          const { data: existingLink } = await supabase
            .from("user_books")
            .select("id")
            .eq("user_id", user.id)
            .eq("book_id", raceConditionBook.id)
            .single();
          
          if (!existingLink) {
            await supabase.from("user_books").insert({
              user_id: user.id,
              book_id: raceConditionBook.id,
            });
          }
          
          return NextResponse.json({ 
            book_id: raceConditionBook.id,
            duplicate: true,
            message: "Book already exists and has been added to your library"
          });
        }
      }
      
      return NextResponse.json({ 
        error: "Failed to create book record",
        details: bookError.message,
        code: bookError.code,
        hint: bookError.hint,
      }, { status: 500 });
    }
    console.log("[UPLOAD] Book record created successfully");

    // Upload to Supabase Storage
    console.log("[UPLOAD] Uploading to storage:", storagePath);
    const { error: uploadError } = await supabase.storage
      .from("epubs")
      .upload(storagePath, arrayBuffer, {
        contentType: "application/epub+zip",
        upsert: false,
      });

    if (uploadError) {
      console.error("[UPLOAD] Storage upload error:", uploadError);
      // Clean up book record if upload fails
      await supabase.from("books").delete().eq("id", bookId);
      
      return NextResponse.json({ 
        error: "Failed to upload file to storage",
        details: uploadError.message 
      }, { status: 500 });
    }
    console.log("[UPLOAD] File uploaded to storage successfully");

    // Link book to user
    console.log("[UPLOAD] Linking book to user...");
    const { error: linkError } = await supabase
      .from("user_books")
      .insert({
        user_id: user.id,
        book_id: bookId,
      });

    if (linkError) {
      console.error("[UPLOAD] Error linking book to user:", linkError);
      // Clean up: delete book and storage file
      await supabase.from("books").delete().eq("id", bookId);
      await supabase.storage.from("epubs").remove([storagePath]);
      
      return NextResponse.json({ 
        error: "Failed to link book to user",
        details: linkError.message 
      }, { status: 500 });
    }
    console.log("[UPLOAD] Book linked to user successfully");

    console.log("[UPLOAD] Upload completed successfully");
    return NextResponse.json({ 
      book_id: bookId,
      message: "Book uploaded successfully"
    });

  } catch (error) {
    console.error("[UPLOAD] Unexpected error:", error);
    if (error instanceof Error) {
      console.error("[UPLOAD] Error stack:", error.stack);
    }
    return NextResponse.json({ 
      error: "Internal server error",
      details: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 });
  }
}
