!ifndef BUILD_UNINSTALLER
Var /GLOBAL legacyInstallDir
!endif

!macro customCheckAppRunning
  DetailPrint "$(appClosing)"
  nsExec::Exec `"$SYSDIR\taskkill.exe" /F /IM "${APP_EXECUTABLE_FILENAME}"`
  Pop $R0
  Sleep 500

  !ifndef BUILD_UNINSTALLER
  # HitMuse 1.0.1 shipped with a broken process check in its uninstaller.
  # Remove only that stale uninstall registration so upgrades do not invoke it.
  # User data lives under AppData and is intentionally untouched.
  ReadRegStr $R1 HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  ${If} $R1 == "1.0.1"
    ReadRegStr $R2 HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    ${If} $R2 == "$LocalAppData\Programs\HitMuse"
      StrCpy $legacyInstallDir $R2
    ${EndIf}
    DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
    DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
    StrCpy $INSTDIR "$LocalAppData\Programs\HitMuse App"
    StrCpy $appExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${EndIf}
  !endif
!macroend

!ifndef BUILD_UNINSTALLER
!macro customInstall
  ${If} $legacyInstallDir != ""
    RMDir /r /REBOOTOK "$legacyInstallDir"
  ${EndIf}

  ${If} ${FileExists} "$newStartMenuLink"
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newStartMenuLink" "com.hitmuse.desktop.HitMuse"
  ${EndIf}
  ${If} ${FileExists} "$newDesktopLink"
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newDesktopLink" "com.hitmuse.desktop.HitMuse"
  ${EndIf}
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
!endif
