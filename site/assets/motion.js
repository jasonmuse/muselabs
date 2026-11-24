// Motion for the pages that share style.css (Poof and Muse Penguin load this; style.css › motion has the rest).
// Liquid, never pops (Moo, Nov 24: "buttery smooth sleek liquid everything always"): sections rise into view as you
// scroll to them, help answers glide open and closed, and pictures fade in over a soft shimmer instead of an empty box.
// With Reduce Motion on, or if anything here fails, the page simply shows, the way it always did.
(() => {
  const root = document.documentElement;
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  if (calm.matches) return;
  const ease = "cubic-bezier(0.2, 0.8, 0.2, 1)";

  try {
    root.classList.add("motion");

    // Pictures still on their way fade in when they arrive (their frame shimmers meanwhile).
    for (const img of document.images) {
      if (img.complete) continue;
      img.classList.add("fade");
      const show = () => img.classList.add("loaded");
      img.addEventListener("load", show, { once: true });
      img.addEventListener("error", show, { once: true });
    }

    // Sections further down rise into view as you scroll to them. Whatever's already on screen stays put.
    if ("IntersectionObserver" in window) {
      const reveal = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add("in");
            reveal.unobserve(entry.target);
          }
        },
        { rootMargin: "0px 0px -8% 0px" }
      );
      const fold = innerHeight * 0.92;
      for (const el of document.querySelectorAll("main .section > h2, .steps li, .card, .phone > *, .plan, .faq details")) {
        if (el.getBoundingClientRect().top < fold) continue;
        el.style.setProperty("--i", [...el.parentElement.children].indexOf(el) % 3);
        el.classList.add("reveal");
        reveal.observe(el);
      }
    }

    // Help answers glide open and closed: measure both heights, then animate between them.
    for (const details of document.querySelectorAll("details")) {
      const summary = details.querySelector("summary");
      if (!summary || !details.animate) continue;
      let height = null;
      let fades = [];
      summary.addEventListener("click", (event) => {
        if (calm.matches) return;
        event.preventDefault();
        const answer = [...details.children].filter((el) => el !== summary);
        const closing = details.open && !details.classList.contains("closing");
        // start from wherever it is now, even halfway through the last click
        const from = details.offsetHeight;
        const now = answer[0] && height ? getComputedStyle(answer[0]) : null;
        const fromOpacity = now ? parseFloat(now.opacity) : closing ? 1 : 0;
        const fromMove = now && now.transform !== "none" ? now.transform : closing ? "none" : "translateY(-6px)";
        height?.cancel();
        for (const fade of fades) fade.cancel();

        details.classList.toggle("closing", closing);
        details.open = true;
        let to = details.offsetHeight;
        if (closing) {
          const box = getComputedStyle(details);
          to = summary.offsetHeight + ["paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"].reduce((sum, side) => sum + parseFloat(box[side]), 0);
        }
        details.style.overflow = "hidden";
        const run = details.animate({ height: [`${from}px`, `${to}px`] }, { duration: 380, easing: ease, fill: "forwards" });
        fades = answer.map((el) =>
          el.animate(
            { opacity: [fromOpacity, closing ? 0 : 1], transform: [fromMove, closing ? "translateY(-6px)" : "none"] },
            { duration: closing ? 240 : 380, easing: ease, fill: "forwards" }
          )
        );
        height = run;
        run.onfinish = () => {
          if (closing) details.open = false;
          details.classList.remove("closing");
          details.style.overflow = "";
          run.cancel();
          for (const fade of fades) fade.cancel();
          height = null;
          fades = [];
        };
      });
    }
  } catch {
    root.classList.remove("motion");
  }
})();
