package inventory

import (
	"math"
	"reflect"
	"strings"
)

// structsToMaps converte um ponteiro para fatia de structs (resultado do WMI) em lista de mapas
// com os nomes dos campos como chaves. Textos sao aparados, listas nulas viram vazias e
// floats nao finitos viram 0 (o servidor descarta a mensagem com NaN).
func structsToMaps(ptr any) []map[string]any {
	out := []map[string]any{}
	v := reflect.ValueOf(ptr)
	for v.Kind() == reflect.Ptr {
		if v.IsNil() {
			return out
		}
		v = v.Elem()
	}
	if v.Kind() != reflect.Slice {
		return out
	}
	for i := 0; i < v.Len(); i++ {
		item := v.Index(i)
		if item.Kind() == reflect.Ptr {
			if item.IsNil() {
				continue
			}
			item = item.Elem()
		}
		if item.Kind() != reflect.Struct {
			continue
		}
		t := item.Type()
		m := make(map[string]any, t.NumField())
		for f := 0; f < t.NumField(); f++ {
			if !t.Field(f).IsExported() {
				continue
			}
			m[t.Field(f).Name] = plainValue(item.Field(f))
		}
		out = append(out, m)
	}
	return out
}

func plainValue(v reflect.Value) any {
	switch v.Kind() {
	case reflect.String:
		return strings.TrimSpace(strings.ToValidUTF8(v.String(), ""))
	case reflect.Bool:
		return v.Bool()
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return v.Int()
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return v.Uint()
	case reflect.Float32, reflect.Float64:
		f := v.Float()
		if math.IsNaN(f) || math.IsInf(f, 0) {
			return 0.0
		}
		return f
	case reflect.Slice:
		list := make([]any, 0, v.Len())
		for i := 0; i < v.Len(); i++ {
			list = append(list, plainValue(v.Index(i)))
		}
		return list
	case reflect.Ptr:
		if v.IsNil() {
			return nil
		}
		return plainValue(v.Elem())
	}
	return nil
}
