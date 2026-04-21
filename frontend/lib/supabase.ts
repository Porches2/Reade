import { createClient } from "@supabase/supabase-js";
import { auth } from "./firebase";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  accessToken: async () => {
    const user = auth.currentUser;
    if (!user) return null;
    return await user.getIdToken(false);
  },
});

export const BUCKET_PDFS = "pdfs";
export const BUCKET_THUMBNAILS = "thumbnails";

export function thumbnailPublicUrl(userId: string, pdfId: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_THUMBNAILS}/${userId}/${pdfId}.png`;
}
