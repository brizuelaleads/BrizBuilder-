import { removeMetaSocialUser } from "../../../../../db/supabase-meta-social";
import { socialDeletionHandlers } from "../../../../../lib/meta-social-deletion";

export const dynamic = "force-dynamic";

export const { GET, POST } = socialDeletionHandlers("meta-social", removeMetaSocialUser);
