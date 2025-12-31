'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';

interface BookReaderProps {
  bookId: string;
  manifestPath: string;
  title: string;
}

export function BookReader({ bookId, manifestPath, title }: BookReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigatorRef = useRef<any>(null);

  useEffect(() => {
    let mounted = true;

    async function loadBook() {
      if (!containerRef.current) return;

      try {
        // Dynamically import Readium packages
        const [
          { EpubNavigator, EpubNavigatorListeners, FrameManager, FXLFrameManager },
          { Manifest, Publication, HttpFetcher, Link: ReadiumLink, Locator, LocatorLocations },
          { BasicTextSelection, FrameClickEvent }
        ] = await Promise.all([
          import('@readium/navigator'),
          import('@readium/shared'),
          import('@readium/navigator-html-injectables')
        ]);

        // Construct public URL for the manifest file
        // Since the bucket is public, we can use the public URL format directly
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        if (!supabaseUrl) {
          throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured');
        }

        // Public URL format: {SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{PATH}
        // Extract the base URL (directory containing manifest.json)
        // e.g., if manifestPath is "books_xxx/manifest.json", baseUrl should point to that directory
        const manifestDir = manifestPath.substring(0, manifestPath.lastIndexOf('/') + 1);
        const baseUrl = `${supabaseUrl}/storage/v1/object/public/readium-manifests/${manifestDir}`;
        
        // Use Readium fetcher to get the manifest (following testapp pattern)
        const manifestLink = new ReadiumLink({ href: 'manifest.json' });
        const fetcher = new HttpFetcher(undefined, baseUrl);
        const fetched = fetcher.get(manifestLink);
        const selfLink = (await fetched.link()).toURL(baseUrl)!;
        
        // Read manifest as JSON
        const manifestJson = await fetched.readAsJSON();
        
        // Ensure we have a valid object
        if (!manifestJson || typeof manifestJson !== 'object') {
          console.error('Manifest is not a valid object:', typeof manifestJson, manifestJson);
          throw new Error('Manifest is not a valid JSON object');
        }
        
        // Ensure required fields exist - links is required by Manifest.deserialize
        const manifestObj = manifestJson as Record<string, unknown>;
        if (!Array.isArray(manifestObj.links)) {
          manifestObj.links = [];
        }
        
        // Deserialize manifest - deserialize expects an object
        const manifest = Manifest.deserialize(manifestObj);
        
        if (!manifest) {
          console.error('Manifest deserialize failed. Manifest structure:', {
            hasContext: '@context' in manifestJson,
            hasMetadata: 'metadata' in manifestJson,
            hasReadingOrder: 'readingOrder' in manifestJson,
            hasResources: 'resources' in manifestJson,
            hasToc: 'toc' in manifestJson,
            keys: Object.keys(manifestJson),
            sample: JSON.stringify(manifestJson).substring(0, 1000)
          });
          throw new Error('Failed to parse manifest - deserialize returned null. Check console for details.');
        }
        
        // Set self link
        manifest.setSelfLink(selfLink);
        const publication = new Publication({ manifest, fetcher });

        // Validate reading order exists
        if (!publication.readingOrder || publication.readingOrder.items.length === 0) {
          throw new Error('Publication has no reading order items');
        }

        // CRITICAL: Generate positions from readingOrder BEFORE creating navigator
        // positionsFromManifest() returns empty array if no position list link exists
        // Without positions, currentLocation becomes undefined and accessing .locations fails
        let positions = await publication.positionsFromManifest();
        
        if (positions.length === 0) {
          // Generate positions from readingOrder - this is REQUIRED
          positions = publication.readingOrder.items.map((link, index) => {
            // Try to get locator from manifest first
            const locator = publication.manifest.locatorFromLink(link);
            if (locator) {
              return locator;
            }
            // Fallback: create locator manually with locations property
            return new Locator({
              href: link.href,
              type: link.type || 'text/html',
              locations: new LocatorLocations({
                fragments: [],
                progression: 0,
                position: index + 1
              })
            });
          });
        }

        if (positions.length === 0) {
          throw new Error('Failed to generate positions - reading order is empty');
        }

        if (!mounted) return;

        const listeners: EpubNavigatorListeners = {
          frameLoaded: function (wnd: Window): void {
            // Frame loaded callback
          },
          positionChanged: function (locator: any): void {
            window.focus();
          },
          tap: function (e: FrameClickEvent): boolean {
            return false;
          },
          click: function (e: FrameClickEvent): boolean {
            return false;
          },
          zoom: function (scale: number): void {
            // Zoom callback
          },
          miscPointer: function (amount: number): void {
            // Misc pointer callback
          },
          customEvent: function (key: string, data: unknown): void {
            // Custom event callback
          },
          handleLocator: function (locator: any): boolean {
            const href = locator.href;
            if (href.startsWith("http://") ||
                href.startsWith("https://") ||
                href.startsWith("mailto:") ||
                href.startsWith("tel:")) {
              window.open(href, "_blank");
            }
            return false;
          },
          textSelected: function (selection: BasicTextSelection): void {
            // Text selection callback
          }
        };

        // CRITICAL: Pass positions as 4th parameter to constructor
        // This ensures currentLocation is set correctly and prevents undefined.locations error
        const nav = new EpubNavigator(containerRef.current, publication, listeners, positions);
        await nav.load();
        
        navigatorRef.current = nav;
        setLoading(false);
      } catch (err) {
        console.error('Error loading book:', err);
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load book');
          setLoading(false);
        }
      }
    }

    loadBook();

    return () => {
      mounted = false;
      // Cleanup navigator if needed
      if (navigatorRef.current) {
        // Navigator cleanup if available
      }
    };
  }, [bookId, manifestPath]);

  if (error) {
    return (
      <div className="min-h-screen flex flex-col">
        <div className="border-b p-4 flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
            Back to Library
          </Link>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-2">Error Loading Book</h1>
            <p className="text-muted-foreground mb-4">{error}</p>
            <Link href="/" className="text-primary hover:underline">
              Return to library
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="border-b p-4 flex items-center justify-between bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <Link href="/" className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
          Back to Library
        </Link>
        <h1 className="text-lg font-semibold truncate max-w-md">{title}</h1>
        <div className="w-24" /> {/* Spacer for centering */}
      </div>
      <div className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
              <p className="text-muted-foreground">Loading book...</p>
            </div>
          </div>
        )}
        <div
          ref={containerRef}
          className="w-full h-full"
          style={{ minHeight: 'calc(100vh - 73px)' }}
        />
      </div>
    </div>
  );
}
