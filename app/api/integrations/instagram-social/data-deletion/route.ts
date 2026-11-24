import { removeInstagramSocialUser } from "../../../../../db/supabase-instagram-social";
import { socialDeletionHandlers } from "../../../../../lib/meta-social-deletion";

export const dynamic = "force-dynamic";

export const { GET, POST } = socialDeletionHandlers("instagram-social", removeInstagramSocialUser);
