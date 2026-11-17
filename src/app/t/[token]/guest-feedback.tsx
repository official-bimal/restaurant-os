"use client";

import { useState, useTransition } from "react";
import { commentAction, rateAction, rateDishAction } from "./actions";
import { useT } from "./lang";

const LOW_MAX = 3;

export function GuestFeedback({
  token,
  initialRating,
  initialComment,
  canSubmit,
  googleReviewUrl,
  dishes,
}: {
  token: string;
  initialRating: number | null;
  initialComment: string | null;
  canSubmit: boolean;
  googleReviewUrl: string | null;
  dishes: { menuItemId: string; name: string; rating: number | null }[];
}) {
  const t = useT();
  const [rating, setRating] = useState<number | null>(initialRating);
  const [comment, setComment] = useState(initialComment ?? "");
  const [commentSent, setCommentSent] = useState(!!initialComment);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [dishRatings, setDishRatings] = useState<Record<string, number>>(
    Object.fromEntries(dishes.filter((d) => d.rating !== null).map((d) => [d.menuItemId, d.rating as number])),
  );

  if (!canSubmit && rating === null) return null; // too late to rate

  const rate = (value: number) => {
    if (!canSubmit || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await rateAction(token, value);
      if (res.ok) setRating(value);
      else setError(res.error ?? "Something went wrong. Please try again.");
    });
  };

  const rateDish = (menuItemId: string, value: number) => {
    if (!canSubmit || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await rateDishAction(token, menuItemId, value);
      if (res.ok) setDishRatings((r) => ({ ...r, [menuItemId]: value }));
      else setError(res.error ?? "Something went wrong. Please try again.");
    });
  };

  const sendComment = () => {
    setError(null);
    startTransition(async () => {
      const res = await commentAction(token, comment);
      if (res.ok) setCommentSent(true);
      else setError(res.error ?? "Something went wrong. Please try again.");
    });
  };

  const low = rating !== null && rating <= LOW_MAX;

  return (
    <section aria-label="Rate your visit" className="mt-5 rounded-2xl bg-white p-4 border border-stone-200 shadow-sm">
      <h2 className="font-semibold">{rating === null ? t("howWasVisit") : t("thanksRating")}</h2>

      <div role="group" aria-label="Star rating" className="mt-2 flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onClick={() => rate(star)}
            disabled={!canSubmit || pending}
            aria-label={`${star} star${star === 1 ? "" : "s"}`}
            aria-pressed={rating === star}
            className={`h-12 w-12 rounded-lg text-3xl leading-none ${
              rating !== null && star <= rating ? "text-amber-500" : "text-stone-300"
            } ${canSubmit ? "hover:bg-stone-50" : ""}`}
          >
            ★
          </button>
        ))}
      </div>

      {dishes.length > 0 && (canSubmit || Object.keys(dishRatings).length > 0) && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">{t("rateWhatHad")}</h3>
          <ul className="mt-1 divide-y divide-stone-100">
            {dishes.map((d) => (
              <li key={d.menuItemId} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate text-sm">{d.name}</span>
                <span role="group" aria-label={`Rate ${d.name}`} className="flex shrink-0">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onClick={() => rateDish(d.menuItemId, star)}
                      disabled={!canSubmit || pending}
                      aria-label={`${d.name}: ${star} star${star === 1 ? "" : "s"}`}
                      aria-pressed={dishRatings[d.menuItemId] === star}
                      className={`h-10 w-8 text-2xl leading-none ${star <= (dishRatings[d.menuItemId] ?? 0) ? "text-amber-500" : "text-stone-300"}`}
                    >
                      ★
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {rating !== null && canSubmit && (
        <div className="mt-3 space-y-2 text-sm">
          {commentSent ? (
            <p role="status" className="rounded-lg bg-green-50 p-2 text-green-900">
              {low ? t("thankPassedOn") : t("thankComment")}
            </p>
          ) : (
            <>
              <label className="block font-medium">
                {low ? t("sorryWhatWrong") : t("anythingToAdd")}
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  maxLength={500}
                  rows={3}
                  className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-base"
                />
              </label>
              <button
                onClick={sendComment}
                disabled={pending || comment.trim().length === 0}
                className="min-h-11 rounded-lg bg-brand-600 hover:bg-brand-700 px-4 font-medium text-white disabled:opacity-60"
              >
                {pending ? t("sending") : t("send")}
              </button>
              <p className="text-xs text-stone-500">{t("noNameAsked")}</p>
            </>
          )}
        </div>
      )}

      {rating !== null && googleReviewUrl && (
        <p className="mt-3 text-sm">
          <a href={googleReviewUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-800 underline">
            {t("googleReview")}
          </a>
        </p>
      )}
    </section>
  );
}
