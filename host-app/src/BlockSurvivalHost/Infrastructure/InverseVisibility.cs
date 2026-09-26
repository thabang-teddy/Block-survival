using System.Globalization;
using System.Windows;
using System.Windows.Data;

namespace BlockSurvivalHost.Infrastructure;

/// <summary>true hides, false shows</summary>
public sealed class InverseVisibility : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture) =>
        value is true ? Visibility.Collapsed : Visibility.Visible;

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}
