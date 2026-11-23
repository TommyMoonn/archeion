; Tauri's APP_ASSOCIATE writes the extension's default ProgID. Keep Archeion
; in Open With, but restore the value that existed before this installation.
Var EpubPreviousDefault
Var EpubHadDefault

!macro NSIS_HOOK_PREINSTALL
  ClearErrors
  ReadRegStr $EpubPreviousDefault SHCTX "Software\Classes\.epub" ""
  ${If} ${Errors}
    StrCpy $EpubHadDefault 0
  ${Else}
    StrCpy $EpubHadDefault 1
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $EpubHadDefault = 1
    WriteRegStr SHCTX "Software\Classes\.epub" "" "$EpubPreviousDefault"
  ${Else}
    DeleteRegValue SHCTX "Software\Classes\.epub" ""
  ${EndIf}
!macroend
