# A layer key's action word breaks mid-word on small caps

"L4 toggle" renders as "toggl / e" at 1280×577 and on a 390 px phone (`rung16/shots/phone-right-half-light-390.png`). The phone legend floor of 10 px from 18-visual-design.md isn't implemented, and the fitter wraps inside a word. Shorten the action word ("tog") or drop to the 10 px phone floor before wrapping, and never break inside a word.
