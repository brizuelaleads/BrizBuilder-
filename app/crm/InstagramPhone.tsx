"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AtSign, Bookmark, ChevronDown, ChevronLeft, Clapperboard, Copy, Ellipsis, Grid3x3, Heart, House, Link2, Menu,
  Battery, MessageCircle, Search, Send, Signal, SquarePlus, SquareUserRound, Wifi,
} from "lucide-react";
import type { SocialPublishedPage, SocialPublishedPost } from "../../lib/meta-social-core";

/*
 * A phone-sized, Instagram-style rendering of real account data. Everything a
 * viewer can press does something real (switch tabs, open a post, open
 * Instagram); the app chrome around it (status bar, bottom bar, like/share
 * icons) is decorative and hidden from assistive technology.
 */

type Tab = "posts" | "reels" | "tagged";

const isVideo = (mediaType: string) => /reel|video/iu.test(mediaType);
const isCarousel = (mediaType: string) => /carousel|album/iu.test(mediaType);

export function formatInstagramCount(value: number | null | undefined, fallback?: number) {
  const resolved = value ?? fallback;
  if (resolved === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: resolved >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(resolved);
}

function formatPostDate(date: string) {
  const timestamp = Date.parse(date);
  if (!Number.isFinite(timestamp)) return "";
  const sameYear = new Date(timestamp).getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat("en-US", {
    month: "long", day: "numeric", ...(sameYear ? {} : { year: "numeric" }),
  }).format(timestamp);
}

function initialsOf(name: string) {
  return name.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "IG";
}

/** Meta serves media from rotating CDN hosts, so these cannot use a fixed Next Image allowlist. */
function RemoteImage({ src, alt = "", lazy }: { src: string; alt?: string; lazy?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading={lazy ? "lazy" : undefined} referrerPolicy="no-referrer" />;
}

function Avatar({ src, name, size, ring }: { src: string | null | undefined; name: string; size: "lg" | "sm"; ring?: boolean }) {
  return (
    <span className={`crm-ig-avatar ${size}${ring ? " ring" : ""}`}>
      <span>{src ? <RemoteImage src={src} /> : initialsOf(name)}</span>
    </span>
  );
}

/** The phone shell: device frame, status bar, scrolling screen and bottom bar. */
export function InstagramDevice({ children, avatar, name, compact }: {
  children: ReactNode;
  avatar?: string | null;
  name: string;
  compact?: boolean;
}) {
  return (
    <div className={`crm-ig-device${compact ? " compact" : ""}`}>
      <div className="crm-ig-screen">
        <div className="crm-ig-statusbar" aria-hidden="true">
          <span>9:41</span>
          <span className="crm-ig-island" />
          <span className="crm-ig-status-icons">
            <Signal size={16} strokeWidth={2.4} /><Wifi size={16} strokeWidth={2.4} /><Battery size={24} strokeWidth={1.6} />
          </span>
        </div>
        {children}
        {!compact && (
          <div className="crm-ig-bottombar" aria-hidden="true">
            <House size={24} strokeWidth={1.8} />
            <Search size={24} strokeWidth={1.8} />
            <SquarePlus size={24} strokeWidth={1.8} />
            <Clapperboard size={24} strokeWidth={1.8} />
            <Avatar src={avatar} name={name} size="sm" />
          </div>
        )}
      </div>
    </div>
  );
}

/** One Instagram feed post: header, media, action row, likes, caption, date. */
export function InstagramPostCard({ username, avatar, name, imageUrl, mediaType = "IMAGE", caption, date, likeCount, commentCount, permalink }: {
  username: string;
  avatar?: string | null;
  name: string;
  imageUrl: string | null;
  mediaType?: string;
  caption: string;
  date?: string;
  likeCount?: number | null;
  commentCount?: number | null;
  permalink?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = caption.length > 125 || caption.split("\n").length > 2;
  const when = date ? formatPostDate(date) : "";
  return (
    <article className="crm-ig-post">
      <header>
        <Avatar src={avatar} name={name} size="sm" />
        <strong>{username}</strong>
        <Ellipsis size={20} aria-hidden="true" />
      </header>
      <div className="crm-ig-post-media">
        {imageUrl ? <RemoteImage src={imageUrl} alt={caption ? caption.slice(0, 120) : "Post media"} lazy />
          : <span className="crm-ig-media-empty">{mediaType === "IMAGE" ? "Add a public image link to see it here" : mediaType.replaceAll("_", " ").toLowerCase()}</span>}
        {isVideo(mediaType) && <Clapperboard className="crm-ig-media-badge" size={20} aria-hidden="true" />}
        {isCarousel(mediaType) && <Copy className="crm-ig-media-badge" size={20} aria-hidden="true" />}
      </div>
      <div className="crm-ig-post-actions" aria-hidden="true">
        <Heart size={24} strokeWidth={1.8} />
        <MessageCircle size={24} strokeWidth={1.8} />
        <Send size={23} strokeWidth={1.8} />
        <Bookmark size={24} strokeWidth={1.8} />
      </div>
      <div className="crm-ig-post-body">
        {likeCount !== null && likeCount !== undefined && (
          <strong>{likeCount === 1 ? "1 like" : `${formatInstagramCount(likeCount)} likes`}</strong>
        )}
        {caption && (
          <p className={long && !expanded ? "clamped" : undefined}>
            <strong>{username}</strong> {caption}
          </p>
        )}
        {long && !expanded && (
          <button type="button" className="crm-ig-btn crm-ig-more" onClick={() => setExpanded(true)}>more</button>
        )}
        {commentCount ? (permalink
          ? <a className="crm-ig-muted" href={permalink} target="_blank" rel="noreferrer">
            View {commentCount === 1 ? "1 comment" : `all ${commentCount} comments`}
          </a>
          : <span className="crm-ig-muted">{commentCount === 1 ? "1 comment" : `${commentCount} comments`}</span>) : null}
        {when && <time className="crm-ig-date" dateTime={date}>{when}</time>}
      </div>
    </article>
  );
}

function httpsUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** A draft rendered as it will appear in the Instagram feed, updated as it is edited. */
export function InstagramDraftPreview({ username, caption, mediaUrl }: { username: string; caption: string; mediaUrl: string }) {
  return (
    <aside className="crm-social-compose-preview" aria-label="Instagram preview">
      <span>Instagram preview</span>
      <InstagramDevice compact name={username}>
        <div className="crm-ig-appbar">
          <span className="crm-ig-icon-btn" aria-hidden="true"><ChevronLeft size={26} strokeWidth={1.8} /></span>
          <div className="crm-ig-appbar-title">
            <small>{username.toUpperCase()}</small>
            <strong>Posts</strong>
          </div>
          <span className="crm-ig-icon-btn" aria-hidden="true" />
        </div>
        <div className="crm-ig-scroll">
          <InstagramPostCard username={username} name={username} imageUrl={httpsUrl(mediaUrl)} caption={caption.trim()} />
        </div>
      </InstagramDevice>
    </aside>
  );
}

export function InstagramProfilePhone({ data, fallbackName }: { data: SocialPublishedPage; fallbackName: string }) {
  const [tab, setTab] = useState<Tab>("posts");
  const [openPost, setOpenPost] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const lastTile = useRef<string | null>(null);

  const { items, profile } = data;
  const username = profile?.username || fallbackName.replace(/^@/, "").replace(/\s+/g, "").toLowerCase();
  const name = profile?.name || fallbackName.replace(/^@/, "");
  const avatar = profile?.profilePictureUrl;
  const grids: Record<Tab, SocialPublishedPost[]> = {
    posts: items,
    reels: items.filter(({ mediaType }) => isVideo(mediaType)),
    tagged: data.tagged,
  };
  const visible = grids[tab];
  const stories = data.stories.slice(0, 8);
  const profileUrl = /^[a-zA-Z0-9._]{1,30}$/.test(username) ? `https://www.instagram.com/${username}/` : null;

  // Opening a post shows the feed scrolled to it, like tapping a grid tile in the app.
  useEffect(() => {
    const screen = scroller.current;
    if (!screen) return;
    if (openPost) {
      const target = screen.querySelector<HTMLElement>(`[data-post="${CSS.escape(openPost)}"]`);
      screen.scrollTop = target?.offsetTop ?? 0;
      backButton.current?.focus({ preventScroll: true });
    } else {
      screen.scrollTop = 0;
      if (lastTile.current) {
        screen.querySelector<HTMLElement>(`[data-tile="${CSS.escape(lastTile.current)}"]`)?.focus({ preventScroll: true });
      }
    }
  }, [openPost]);

  const tabs: { key: Tab; label: string; icon: typeof Grid3x3 }[] = [
    { key: "posts", label: "Posts", icon: Grid3x3 },
    { key: "reels", label: "Reels", icon: Clapperboard },
    { key: "tagged", label: "Tagged", icon: SquareUserRound },
  ];

  return (
    <InstagramDevice avatar={avatar} name={name}>
      {openPost ? (
        <div className="crm-ig-appbar">
          <button ref={backButton} type="button" className="crm-ig-btn crm-ig-icon-btn" aria-label="Back to profile"
            onClick={() => setOpenPost(null)}>
            <ChevronLeft size={28} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <div className="crm-ig-appbar-title">
            <small>{username.toUpperCase()}</small>
            <strong>{tab === "reels" ? "Reels" : tab === "tagged" ? "Tagged" : "Posts"}</strong>
          </div>
          <span className="crm-ig-icon-btn" aria-hidden="true" />
        </div>
      ) : (
        <div className="crm-ig-appbar">
          <strong className="crm-ig-handle"><span>{username}</span><ChevronDown size={16} strokeWidth={2.4} aria-hidden="true" /></strong>
          <span className="crm-ig-appbar-icons" aria-hidden="true">
            <AtSign size={24} strokeWidth={1.8} />
            <SquarePlus size={24} strokeWidth={1.8} />
            <Menu size={24} strokeWidth={1.8} />
          </span>
        </div>
      )}
      <div className="crm-ig-scroll" ref={scroller}>
        {openPost ? (
          <div className="crm-ig-feed">
            {visible.map((post) => (
              <div key={post.id} data-post={post.id}>
                <InstagramPostCard username={username} avatar={avatar} name={name} imageUrl={post.imageUrl}
                  mediaType={post.mediaType} caption={post.caption} date={post.date} likeCount={post.likeCount}
                  commentCount={post.commentCount} permalink={post.permalink} />
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="crm-ig-profile">
              <div className="crm-ig-summary">
                <Avatar src={avatar} name={name} size="lg" ring={stories.length > 0} />
                <div>
                  <strong className="crm-ig-name">{name}</strong>
                  <dl className="crm-ig-stats">
                    <div><dt>{formatInstagramCount(profile?.mediaCount, items.length)}</dt><dd>posts</dd></div>
                    <div><dt>{formatInstagramCount(profile?.followersCount)}</dt><dd>followers</dd></div>
                    <div><dt>{formatInstagramCount(profile?.followsCount)}</dt><dd>following</dd></div>
                  </dl>
                </div>
              </div>
              {(profile?.biography || profile?.website) && (
                <div className="crm-ig-bio">
                  {profile?.biography && <p>{profile.biography}</p>}
                  {profile?.website && (
                    <a href={profile.website} target="_blank" rel="noreferrer">
                      <Link2 size={14} aria-hidden="true" />{profile.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                    </a>
                  )}
                </div>
              )}
              {profileUrl && (
                <a className="crm-ig-profile-button" href={profileUrl} target="_blank" rel="noreferrer">View on Instagram</a>
              )}
              {stories.length > 0 && (
                <ul className="crm-ig-stories" aria-label="Active stories">
                  {stories.map((story, index) => (
                    <li key={story.id}>
                      <span className="crm-ig-story-ring">
                        <span>{story.imageUrl ? <RemoteImage src={story.imageUrl} /> : initialsOf(name)}</span>
                      </span>
                      <small>Story {index + 1}</small>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <nav className="crm-ig-tabs" aria-label="Instagram profile content">
              {tabs.map(({ key, label, icon: Icon }) => (
                <button type="button" key={key} className={`crm-ig-btn${tab === key ? " active" : ""}`}
                  aria-label={label} aria-current={tab === key ? "page" : undefined} onClick={() => setTab(key)}>
                  <Icon size={24} strokeWidth={tab === key ? 2.2 : 1.8} aria-hidden="true" />
                </button>
              ))}
            </nav>
            {visible.length ? (
              <ul className="crm-ig-grid">
                {visible.map((post) => {
                  const when = formatPostDate(post.date);
                  const label = `${post.caption ? post.caption.slice(0, 80) : post.mediaType.replaceAll("_", " ").toLowerCase()}${when ? ` — ${when}` : ""}`;
                  return (
                    <li key={post.id}>
                      <button type="button" className="crm-ig-btn" data-tile={post.id} aria-label={label} onClick={() => {
                        lastTile.current = post.id;
                        setOpenPost(post.id);
                      }}>
                        {post.imageUrl
                          ? <RemoteImage src={post.imageUrl} lazy />
                          : <span className="crm-ig-media-empty">{post.mediaType.replaceAll("_", " ").toLowerCase()}</span>}
                        {isVideo(post.mediaType) && <Clapperboard className="crm-ig-media-badge" size={18} aria-hidden="true" />}
                        {isCarousel(post.mediaType) && <Copy className="crm-ig-media-badge" size={18} aria-hidden="true" />}
                        {(post.likeCount !== null || post.commentCount !== null) && (
                          <span className="crm-ig-tile-hover" aria-hidden="true">
                            {post.likeCount !== null && <span><Heart size={16} fill="currentColor" />{formatInstagramCount(post.likeCount)}</span>}
                            {post.commentCount !== null && <span><MessageCircle size={16} fill="currentColor" />{formatInstagramCount(post.commentCount)}</span>}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="crm-ig-empty">
                <span>{tab === "posts" ? <Grid3x3 size={30} aria-hidden="true" /> : tab === "reels"
                  ? <Clapperboard size={30} aria-hidden="true" /> : <SquareUserRound size={30} aria-hidden="true" />}</span>
                <strong>{tab === "posts" ? "No posts yet" : tab === "reels" ? "No reels yet" : "No tagged posts yet"}</strong>
                <small>{tab === "tagged" ? "Posts this account is tagged in will appear here." : "Published content appears here automatically."}</small>
              </div>
            )}
          </>
        )}
      </div>
    </InstagramDevice>
  );
}
