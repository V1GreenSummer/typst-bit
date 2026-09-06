// Spike B fixture: short document (~50 lines, representative markup).
// The `revision NNNN` marker is mutated by the harness between compiles
// to model a typical edit -> recompile cycle.
#set page(width: 16cm, height: auto, margin: 1.5cm)
#set text(font: "Libertinus Serif", size: 11pt)
// revision 0001

= Introduction to Typst

Typst is a modern, markup-based typesetting system designed for science
and technical documentation. It compiles documents with excellent
typography and fast turnaround, entirely on the client for this
application. Revision 0001 of this document is a short but
representative example.

== Key features

- *Lightweight markup*: prose, structure, and math in one language
- *Scripting*: functions, variables, and user-defined types
- *Fast compilation*: in-memory, content-addressed caches
- *Math typesetting*: first-class equation support

== A small equation

Here is a classical identity, set inline for demonstration:

$ integral_0^oo e^(-x^2) dif x = sqrt(pi) / 2 $

== A table

#table(
  columns: (auto, 1fr, auto),
  inset: 5pt,
  [Feature], [Description], [Status],
  [Markup], [Headings, lists, emphasis], [Stable],
  [Scripting], [Functions and packages], [Stable],
  [Math], [Equations and symbols], [Stable],
)

== Closing paragraph

#lorem(80)
