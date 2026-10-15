# History labels nest when going back repeatedly

Rung 16's History panel (`04c2509`) titles a go-back as "Back to: " plus the target's summary, so going back to a redo of a go-back reads "Back to: Redo: Back to: Layer 1, key 7: Tap A, hold Left Ctrl" (evidence `rung16/shots/history-light-1440.png`). Title a go-back by the revision it restores ("Back to Today 21:34") and show the restored change's own summary underneath, without repeating prefixes.
