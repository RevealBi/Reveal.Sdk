using System.Reflection;
using Reveal.Sdk.Dom;

namespace DomSamples;

// dotnet run -- api [filter]   lists the public Reveal.Sdk.Dom types whose name contains filter
// dotnet run -- api <Type>     a type's base types, constructors, properties, methods, and the
//                              extension methods that apply to it (SetLabel, ConnectDashboardFilter...)
// The package ships no XML docs; this answers "what does this version actually have".
public static class ApiBrowser
{
    static readonly Assembly Dom = typeof(RdashDocument).Assembly;

    static Type[] PublicTypes() => Dom.GetExportedTypes().OrderBy(t => t.FullName).ToArray();

    public static int Run(string? query)
    {
        var types = PublicTypes();
        var exact = types.Where(t => t.Name == query || t.FullName == query).ToArray();
        if (exact.Length == 1) { Describe(exact[0], types); return 0; }

        var matches = types.Where(t => query == null || t.FullName!.Contains(query, StringComparison.OrdinalIgnoreCase)).ToArray();
        if (matches.Length == 1) { Describe(matches[0], types); return 0; }
        if (matches.Length == 0) { Console.Error.WriteLine($"No public type in {Dom.GetName().Name} matches \"{query}\"."); return 1; }
        Console.WriteLine($"{Dom.GetName().Name} {Dom.GetName().Version}: {matches.Length} type(s)");
        foreach (var group in matches.GroupBy(t => t.Namespace))
        {
            Console.WriteLine($"\n{group.Key}");
            foreach (var t in group) Console.WriteLine($"  {Kind(t),-9} {Name(t)}");
        }
        return 0;
    }

    static void Describe(Type type, Type[] all)
    {
        Console.WriteLine($"{Kind(type)} {type.FullName}");
        var bases = new List<string>();
        for (var b = type.BaseType; b != null && b != typeof(object) && b != typeof(ValueType); b = b.BaseType) bases.Add(Name(b));
        if (bases.Count > 0) Console.WriteLine($"  base: {string.Join(" : ", bases)}");
        var interfaces = type.GetInterfaces().Select(Name).ToArray();
        if (interfaces.Length > 0) Console.WriteLine($"  implements: {string.Join(", ", interfaces)}");

        if (type.IsEnum)
        {
            Section("values", Enum.GetNames(type).Select(n => $"{n} = {Convert.ToInt64(Enum.Parse(type, n))}"));
            return;
        }
        const BindingFlags flags = BindingFlags.Public | BindingFlags.Instance | BindingFlags.Static;
        Section("constructors", type.GetConstructors().Select(c => $"{Name(type)}({Params(c)})"));
        Section("properties", type.GetProperties(flags).Select(p =>
            $"{(p.GetMethod?.IsStatic == true ? "static " : "")}{Name(p.PropertyType)} {p.Name} {{ {(p.CanRead && p.GetMethod!.IsPublic ? "get; " : "")}{(p.CanWrite && p.SetMethod!.IsPublic ? "set; " : "")}}}"
            + (p.DeclaringType != type ? $"   (from {Name(p.DeclaringType!)})" : "")));
        Section("methods", type.GetMethods(flags).Where(m => !m.IsSpecialName && m.DeclaringType != typeof(object))
            .Select(m => $"{(m.IsStatic ? "static " : "")}{Name(m.ReturnType)} {m.Name}{Generic(m)}({Params(m)})"));
        Section("extension methods", all.Where(t => t.IsAbstract && t.IsSealed)
            .SelectMany(t => t.GetMethods(BindingFlags.Public | BindingFlags.Static))
            .Where(m => m.IsDefined(typeof(System.Runtime.CompilerServices.ExtensionAttribute), false) && Applies(m, type))
            .Select(m => $"{Name(m.ReturnType)} {m.Name}{Generic(m)}({Params(m, skipFirst: true)})   ({m.DeclaringType!.Name})"));
    }

    static bool Applies(MethodInfo m, Type type)
    {
        var target = m.GetParameters()[0].ParameterType;
        if (target.IsGenericParameter)
            return target.GetGenericParameterConstraints().All(c => c.IsGenericType ? Implements(type, c.GetGenericTypeDefinition()) : c.IsAssignableFrom(type));
        return target.IsGenericType ? Implements(type, target.GetGenericTypeDefinition()) : target.IsAssignableFrom(type);
    }

    static bool Implements(Type type, Type genericDefinition)
    {
        for (var t = type; t != null; t = t.BaseType)
            if (t.IsGenericType && t.GetGenericTypeDefinition() == genericDefinition) return true;
        return type.GetInterfaces().Any(i => i.IsGenericType && i.GetGenericTypeDefinition() == genericDefinition);
    }

    static void Section(string title, IEnumerable<string> lines)
    {
        var list = lines.Distinct().OrderBy(l => l, StringComparer.Ordinal).ToList();
        if (list.Count == 0) return;
        Console.WriteLine($"\n  {title}:");
        foreach (var l in list) Console.WriteLine($"    {l}");
    }

    static string Kind(Type t) => t.IsEnum ? "enum" : t.IsInterface ? "interface" : t.IsValueType ? "struct"
        : t.IsAbstract && t.IsSealed ? "static" : t.IsAbstract ? "abstract" : "class";

    static string Generic(MethodInfo m) => m.IsGenericMethodDefinition ? $"<{string.Join(", ", m.GetGenericArguments().Select(Name))}>" : "";

    static string Params(MethodBase m, bool skipFirst = false) => string.Join(", ", m.GetParameters().Skip(skipFirst ? 1 : 0).Select(p =>
        $"{(p.IsDefined(typeof(ParamArrayAttribute), false) ? "params " : "")}{Name(p.ParameterType)} {p.Name}{(p.HasDefaultValue ? $" = {p.DefaultValue ?? "null"}" : "")}"));

    static string Name(Type t)
    {
        if (Nullable.GetUnderlyingType(t) is { } u) return Name(u) + "?";
        if (t.IsArray) return Name(t.GetElementType()!) + "[]";
        if (!t.IsGenericType) return Aliases.TryGetValue(t, out var a) ? a : t.Name;
        return $"{t.Name[..t.Name.IndexOf('`')]}<{string.Join(", ", t.GetGenericArguments().Select(Name))}>";
    }

    static readonly Dictionary<Type, string> Aliases = new()
    {
        [typeof(string)] = "string", [typeof(int)] = "int", [typeof(long)] = "long", [typeof(bool)] = "bool",
        [typeof(double)] = "double", [typeof(decimal)] = "decimal", [typeof(object)] = "object", [typeof(void)] = "void",
        [typeof(float)] = "float",
    };
}
