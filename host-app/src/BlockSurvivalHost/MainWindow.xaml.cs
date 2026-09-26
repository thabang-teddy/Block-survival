using System.Windows;
using System.Windows.Controls;
using BlockSurvivalHost.ViewModels;

namespace BlockSurvivalHost;

public partial class MainWindow : Window
{
    private readonly MainViewModel _vm;

    public MainWindow(MainViewModel vm)
    {
        InitializeComponent();
        _vm = vm;
        DataContext = vm;
        // a PasswordBox does not bind: the view model asks for the token when it needs it
        vm.WizardToken = () => WizardToken.Password;
        vm.Confirm = text => MessageBox.Show(this, text, "Block Survival Host", MessageBoxButton.OKCancel, MessageBoxImage.Question) == MessageBoxResult.OK;
        vm.OpenLogRequested += row => new LogWindow(row, _vm) { Owner = this }.Show();
    }

    private async void OnAddWorld(object sender, RoutedEventArgs e)
    {
        AddButton.IsEnabled = false;
        try
        {
            await _vm.AddWorld(AddToken.Password);
            if (!_vm.MessageIsError) AddToken.Clear();
        }
        finally
        {
            AddButton.IsEnabled = true;
        }
    }

    private void OnOpenLog(object sender, RoutedEventArgs e)
    {
        if (((FrameworkElement)sender).DataContext is WorldRow row) _vm.OpenLog(row);
    }
}
