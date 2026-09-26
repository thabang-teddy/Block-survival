// WPF's implicit usings leave these out, and WinForms (for the tray icon) brings
// look-alikes of WPF's MessageBox and Clipboard: these names mean WPF's.
global using System.IO;
global using System.Net.Http;
global using Clipboard = System.Windows.Clipboard;
global using MessageBox = System.Windows.MessageBox;
