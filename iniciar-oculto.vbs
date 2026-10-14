' Arranca iniciar.bat sin ventana: lo usa la tarea programada al iniciar sesion.
Set shell = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = dir
shell.Run "cmd /c """ & dir & "\iniciar.bat""", 0, False
