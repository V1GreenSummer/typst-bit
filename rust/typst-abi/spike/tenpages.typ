// Spike B fixture: ~10 page document.
// The `revision NNNN` marker is mutated by the harness between compiles
// to model a typical edit -> recompile cycle.
#set page(margin: 2cm)
#set text(size: 11pt)

#let revision = [Revision 0001 of this document.]

#let section-body = [
  #lorem(160)

  #lorem(120)
]

#for i in range(20) [
  = Section #calc.even(i + 1)
  #section-body
  #v(1em)
]

#align(bottom)[#revision]
