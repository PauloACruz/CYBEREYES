package winevt

import (
	"encoding/xml"
	"strings"
)

// dataFromXML extrai o texto de EventData/UserData do XML de um evento, usado como mensagem
// quando o provedor nao esta registrado na maquina. Campos com Name viram "Nome: valor".
func dataFromXML(doc string) string {
	dec := xml.NewDecoder(strings.NewReader(doc))
	dec.Strict = false
	var lines []string
	depth := 0 // profundidade dentro de EventData/UserData
	name := ""
	var text strings.Builder
	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if depth == 0 {
				if t.Name.Local == "EventData" || t.Name.Local == "UserData" {
					depth = 1
				}
				continue
			}
			depth++
			name = t.Name.Local
			for _, a := range t.Attr {
				if a.Name.Local == "Name" {
					name = a.Value
				}
			}
			text.Reset()
		case xml.CharData:
			if depth > 1 {
				text.Write(t)
			}
		case xml.EndElement:
			if depth == 0 {
				continue
			}
			if depth > 1 {
				v := strings.TrimSpace(text.String())
				if v != "" {
					if name != "" && name != "Data" {
						lines = append(lines, name+": "+v)
					} else {
						lines = append(lines, v)
					}
				}
				text.Reset()
			}
			depth--
		}
	}
	return strings.Join(lines, "\n")
}
