"use client";

import {
  ConversationProvider,
  useConversation,
  useConversationClientTool,
} from "@elevenlabs/react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { RankedVideo, SearchError, SearchResponse } from "@/lib/types";
import styles from "./finder.module.css";

type Session = {
  description: string;
  feedback: string[];
  round: number;
  /** Every video shown so far; refinements exclude them. */
  shown: string[];
};

type Outcome = { ok: true; videos: RankedVideo[] } | { ok: false; message: string };

type Phase = "idle" | "searching" | "results" | "error";

export function Finder() {
  return (
    <ConversationProvider>
      <FinderApp />
    </ConversationProvider>
  );
}

/** What the voice agent hears back from a tool call. */
function describeForAgent(outcome: Outcome): string {
  if (!outcome.ok) return outcome.message;
  if (outcome.videos.length === 0) return "Nothing matched. Ask for one more detail.";
  const list = outcome.videos
    .map((v, i) => `${i + 1}. "${v.title}" by ${v.channel}${v.reason ? ` (${v.reason})` : ""}`)
    .join("\n");
  return `These ${outcome.videos.length} videos are on screen now:\n${list}`;
}

function FinderApp() {
  const conversation = useConversation();
  const [session, setSession] = useState<Session | null>(null);
  const [videos, setVideos] = useState<RankedVideo[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [notice, setNotice] = useState("");
  const [voiceNote, setVoiceNote] = useState("");
  const [playing, setPlaying] = useState<RankedVideo | null>(null);
  const [draft, setDraft] = useState("");
  const [correction, setCorrection] = useState("");
  const latestRequest = useRef(0);

  const voiceLive = conversation.status === "connected";

  async function runSearch(next: Session, anchor?: RankedVideo): Promise<Outcome> {
    const id = ++latestRequest.current;
    setPhase("searching");
    setNotice("");
    setPlaying(null);

    let data: SearchResponse | SearchError;
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: next.description,
          feedback: next.feedback,
          round: next.round,
          exclude: next.shown,
          anchor: anchor && {
            title: anchor.title.slice(0, 200),
            channel: anchor.channel.slice(0, 100),
            description: anchor.description.slice(0, 500),
            tags: anchor.tags.slice(0, 20).map((tag) => tag.slice(0, 60)),
          },
        }),
      });
      data = await res.json();
    } catch {
      data = { error: "upstream", message: "Lost the connection. Try that again?" };
    }

    if (id !== latestRequest.current) return { ok: false, message: "A newer search replaced this one." };
    if ("error" in data) {
      setPhase("error");
      setNotice(data.message);
      return { ok: false, message: data.message };
    }
    setSession({ ...next, shown: [...next.shown, ...data.videos.map((v) => v.id)] });
    setVideos(data.videos);
    setPhase("results");
    return { ok: true, videos: data.videos };
  }

  function search(description: string): Promise<Outcome> {
    return runSearch({ description, feedback: [], round: 0, shown: [] });
  }

  function refine(feedback: string, closerTo?: RankedVideo): Promise<Outcome> {
    if (!session) return search(feedback);
    const note = feedback.trim();
    return runSearch(
      {
        ...session,
        feedback: note ? [...session.feedback, note] : session.feedback,
        round: session.round + 1,
      },
      closerTo,
    );
  }

  function startOver() {
    latestRequest.current++;
    setSession(null);
    setVideos([]);
    setPhase("idle");
    setNotice("");
    setCorrection("");
  }

  useConversationClientTool("search_videos", async (params) =>
    describeForAgent(await search(String(params.description ?? ""))),
  );

  useConversationClientTool("refine_search", async (params) => {
    const number = Number(params.closer_to);
    const anchor = Number.isInteger(number) ? videos[number - 1] : undefined;
    return describeForAgent(await refine(String(params.feedback ?? ""), anchor));
  });

  useConversationClientTool("show_video", (params) => {
    const video = videos[Number(params.number) - 1];
    if (!video) return "There's no video with that number on screen.";
    setPlaying(video);
    return `Now playing "${video.title}".`;
  });

  useEffect(() => {
    if (!playing) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setPlaying(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing]);

  async function toggleVoice() {
    if (conversation.status === "connected" || conversation.status === "connecting") {
      conversation.endSession();
      return;
    }
    setVoiceNote("");
    try {
      // Ask for the mic up front so a denial gets a friendly message.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch {
      setVoiceNote("I need your mic to hear you. Or just type it!");
      return;
    }

    const res = await fetch("/api/voice-token").catch(() => null);
    const data = await res?.json().catch(() => null);
    if (!res?.ok || !data?.token) {
      setVoiceNote(data?.message ?? "Couldn't wake the voice up. Type it instead?");
      return;
    }
    conversation.startSession({
      conversationToken: data.token,
      connectionType: "webrtc",
      onError: () => setVoiceNote("The voice line dropped. Tap to try again."),
    });
  }

  function onDescribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    if (voiceLive) conversation.sendUserMessage(text);
    else void search(text);
  }

  function onCorrect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = correction.trim();
    if (!text) return;
    setCorrection("");
    if (voiceLive) conversation.sendUserMessage(text);
    else void refine(text);
  }

  function pick(video: RankedVideo, index: number) {
    setPlaying(video);
    if (voiceLive) conversation.sendUserMessage(`That's it! Number ${index + 1}.`);
  }

  async function closer(video: RankedVideo, index: number) {
    const outcome = await refine("", video);
    if (voiceLive) {
      conversation.sendContextualUpdate(
        `The user tapped "closer" on #${index + 1}, "${video.title}". ${describeForAgent(outcome)}`,
      );
    }
  }

  const voiceLabel =
    conversation.status === "connecting"
      ? "Waking up…"
      : voiceLive
        ? conversation.isSpeaking
          ? "Talking…"
          : "Listening… tap to hang up"
        : voiceNote || "Tap and tell me";

  const hasResults = phase !== "idle";

  return (
    <main className={styles.main} data-compact={hasResults}>
      <header className={styles.header}>
        <span className={styles.logo}>What Was That Video?</span>
        {hasResults && (
          <button type="button" className={styles.linkButton} onClick={startOver}>
            Start over
          </button>
        )}
      </header>

      <section className={styles.hero}>
        <h1 className={styles.question}>What do you remember?</h1>
        <p className={styles.tagline}>Describe it badly. I&apos;ll find it anyway.</p>

        <button
          type="button"
          className={styles.mic}
          data-state={voiceLive ? (conversation.isSpeaking ? "speaking" : "listening") : conversation.status}
          onClick={toggleVoice}
          aria-label={voiceLive ? "Hang up" : "Talk to me"}
        >
          <MicIcon />
        </button>
        <p className={styles.voiceLabel} aria-live="polite">
          {voiceLabel}
        </p>

        <form className={styles.inputRow} onSubmit={onDescribe}>
          <input
            className={styles.input}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="…or type it: guy on a treadmill, wedding, falls?"
            aria-label="Describe the video"
            maxLength={500}
          />
          <button type="submit" className={styles.primary} disabled={!draft.trim()}>
            Find it
          </button>
        </form>
      </section>

      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}

      {hasResults && (
        <section className={styles.results} aria-live="polite" aria-busy={phase === "searching"}>
          {phase === "searching" ? (
            <>
              <p className={styles.status}>Rummaging through the internet…</p>
              <ul className={styles.grid}>
                {[0, 1, 2, 3].map((i) => (
                  <li key={i} className={`${styles.card} ${styles.skeleton}`} aria-hidden="true">
                    <div className={styles.thumb} />
                    <div className={styles.cardBody}>
                      <div className={styles.skeletonLine} />
                      <div className={styles.skeletonLineShort} />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : videos.length > 0 ? (
            <>
              <p className={styles.status}>Pretty sure it&apos;s one of these.</p>
              <ul className={styles.grid}>
                {videos.map((video, i) => (
                  <li key={video.id} className={styles.card}>
                    <button
                      type="button"
                      className={styles.thumb}
                      onClick={() => setPlaying(video)}
                      aria-label={`Play ${video.title}`}
                    >
                      {video.thumbnail && (
                        // YouTube already serves these at display size.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={video.thumbnail} alt="" loading="lazy" />
                      )}
                      <span className={styles.rank}>{i + 1}</span>
                    </button>
                    <div className={styles.cardBody}>
                      <h2 className={styles.title}>{video.title}</h2>
                      <p className={styles.channel}>{video.channel}</p>
                      {video.reason && <p className={styles.reason}>{video.reason}</p>}
                      <div className={styles.actions}>
                        <button type="button" className={styles.primary} onClick={() => pick(video, i)}>
                          That&apos;s it!
                        </button>
                        <button type="button" className={styles.secondary} onClick={() => closer(video, i)}>
                          Closer…
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            phase === "results" && <p className={styles.status}>Nothing yet. Give me one more detail?</p>
          )}

          {session && phase !== "searching" && (
            <form className={styles.inputRow} onSubmit={onCorrect}>
              <input
                className={styles.input}
                value={correction}
                onChange={(event) => setCorrection(event.target.value)}
                placeholder="Not it? Tell me what's off: “no, it was a cat”"
                aria-label="What's different about the video?"
                maxLength={200}
              />
              <button type="submit" className={styles.secondary} disabled={!correction.trim()}>
                Try again
              </button>
            </form>
          )}
        </section>
      )}

      <footer className={styles.footer}>Searches YouTube for now. Voice by ElevenLabs, brains by Claude.</footer>

      {playing && (
        <div className={styles.overlay} onClick={() => setPlaying(null)}>
          <div
            className={styles.player}
            role="dialog"
            aria-modal="true"
            aria-label={playing.title}
            onClick={(event) => event.stopPropagation()}
          >
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${playing.id}?autoplay=1`}
              title={playing.title}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
            />
            <div className={styles.playerBar}>
              <span className={styles.playerTitle}>{playing.title}</span>
              <a href={`https://www.youtube.com/watch?v=${playing.id}`} target="_blank" rel="noreferrer">
                Open on YouTube
              </a>
              <button type="button" className={styles.secondary} onClick={() => setPlaying(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="44" height="44" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-6a3.5 3.5 0 1 0-7 0v6A3.5 3.5 0 0 0 12 15Zm6-3.5a1 1 0 1 0-2 0 4 4 0 0 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.91V20H8.5a1 1 0 1 0 0 2h7a1 1 0 1 0 0-2H13v-2.59A6 6 0 0 0 18 11.5Z"
      />
    </svg>
  );
}
