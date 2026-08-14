import { Publication } from "@/lib/types";

// Rendering for a researcher's papers. Every link here comes from the metadata
// provider, so a "PDF" badge means an open-access copy really exists rather
// than a guess at a publisher URL.

function MetaLine({ pub }: { pub: Publication }) {
  const bits = [pub.venue, pub.year ? String(pub.year) : null].filter(Boolean);
  return (
    <p className="text-[13px] text-[#777169]">
      {bits.join(" · ")}
      {typeof pub.citations === "number" && pub.citations > 0 && (
        <>
          {bits.length > 0 && " · "}
          <span className="font-mono text-[12px]">{pub.citations.toLocaleString()}</span> citations
        </>
      )}
    </p>
  );
}

export function PublicationItem({ pub }: { pub: Publication }) {
  return (
    <li className="border-t border-[#e5e5e5] py-5 first:border-t-0 first:pt-0">
      <h3 className="text-[15px] leading-6 font-medium">
        {pub.url ? (
          <a href={pub.url} target="_blank" rel="noreferrer" className="hover:underline underline-offset-2">
            {pub.title}
          </a>
        ) : (
          pub.title
        )}
      </h3>

      {/* Badges ride with the metadata rather than the title, so the row lands
          in the same place whether the title takes one line or three. */}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <MetaLine pub={pub} />
        <div className="flex shrink-0 gap-2">
          {pub.pdfUrl && (
            <a
              href={pub.pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 items-center rounded-full border border-[#ff4704]/30 bg-[#ff4704]/8 px-3 text-[12px] text-[#ff4704] hover:bg-[#ff4704]/15"
            >
              PDF
            </a>
          )}
          {pub.doi && (
            <a
              href={`https://doi.org/${pub.doi}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 items-center rounded-full border border-[#e5e5e5] px-3 text-[12px] text-[#777169] hover:border-black hover:text-black"
            >
              DOI
            </a>
          )}
        </div>
      </div>

      {pub.authors.length > 0 && (
        <p className="mt-1.5 line-clamp-1 text-[12px] text-[#777169]">{pub.authors.join(", ")}</p>
      )}
      {pub.abstract && <p className="mt-2 line-clamp-3 text-[13px] leading-5 text-[#777169]">{pub.abstract}</p>}
    </li>
  );
}

export default function PublicationList({ publications }: { publications: Publication[] }) {
  return (
    <ul className="mt-5">
      {publications.map((pub) => (
        <PublicationItem key={`${pub.doi ?? ""}${pub.title}`} pub={pub} />
      ))}
    </ul>
  );
}
