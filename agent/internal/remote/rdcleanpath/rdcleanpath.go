// Package rdcleanpath implementa o RDCleanPath, o protocolo com que o cliente RDP do navegador (IronRDP) pede a um
// proxy a conexao ao servidor RDP: o proxy faz o X.224 e o TLS com o servidor e devolve a resposta X.224 e a cadeia
// de certificados; depois disso o navegador manda o RDP sem TLS e o proxy o leva para dentro do TLS.
//
// A estrutura segue crates/ironrdp-rdcleanpath (DER, SEQUENCE com campos de tag de contexto EXPLICIT).
package rdcleanpath

import (
	"encoding/asn1"
	"errors"
)

// Version1 e a versao do protocolo (3389 + 1).
const Version1 = 3390

// Codigos de erro.
const (
	GeneralError     = 1
	NegotiationError = 2
)

// Err e o erro informado pelo proxy ao cliente.
type Err struct {
	Code           int `asn1:"explicit,tag:0"`
	HTTPStatusCode int `asn1:"explicit,optional,tag:1"`
	WSALastError   int `asn1:"explicit,optional,tag:2"`
	TLSAlertCode   int `asn1:"explicit,optional,tag:3"`
}

// PDU e a mensagem do RDCleanPath. Campos vazios ficam fora da codificacao.
type PDU struct {
	Version           int64    `asn1:"explicit,tag:0"`
	Error             Err      `asn1:"explicit,optional,tag:1"`
	Destination       string   `asn1:"explicit,optional,tag:2,utf8"`
	ProxyAuth         string   `asn1:"explicit,optional,tag:3,utf8"`
	ServerAuth        string   `asn1:"explicit,optional,tag:4,utf8"`
	PreconnectionBlob string   `asn1:"explicit,optional,tag:5,utf8"`
	X224ConnectionPDU []byte   `asn1:"explicit,optional,tag:6"`
	ServerCertChain   [][]byte `asn1:"explicit,optional,tag:7"`
	ServerAddr        string   `asn1:"explicit,optional,tag:9,utf8"`
}

// ErrNotRequest indica uma mensagem que nao e um pedido comum (com X.224) de RDCleanPath.
var ErrNotRequest = errors.New("mensagem RDCleanPath sem destino ou sem X.224")

// Decode le uma mensagem completa.
func Decode(der []byte) (PDU, error) {
	var p PDU
	rest, err := asn1.Unmarshal(der, &p)
	if err != nil {
		return PDU{}, err
	}
	if len(rest) != 0 {
		return PDU{}, errors.New("bytes sobrando depois da mensagem RDCleanPath")
	}
	if p.Version != Version1 {
		return PDU{}, errors.New("versao de RDCleanPath nao suportada")
	}
	return p, nil
}

// DecodeRequest le o pedido do cliente e confere os campos obrigatorios.
func DecodeRequest(der []byte) (PDU, error) {
	p, err := Decode(der)
	if err != nil {
		return PDU{}, err
	}
	if p.Destination == "" || len(p.X224ConnectionPDU) == 0 {
		return PDU{}, ErrNotRequest
	}
	return p, nil
}

// Encode codifica a mensagem em DER.
func (p PDU) Encode() ([]byte, error) {
	p.Version = Version1
	return asn1.Marshal(p)
}

// NewRequest monta um pedido (usado nos testes, como o navegador faria).
func NewRequest(x224 []byte, destination, proxyAuth, pcb string) PDU {
	return PDU{Version: Version1, Destination: destination, ProxyAuth: proxyAuth, PreconnectionBlob: pcb, X224ConnectionPDU: x224}
}

// NewResponse monta a resposta de sucesso: endereco do servidor, X.224 do servidor e cadeia de certificados.
func NewResponse(serverAddr string, x224 []byte, chain [][]byte) PDU {
	return PDU{Version: Version1, X224ConnectionPDU: x224, ServerCertChain: chain, ServerAddr: serverAddr}
}

// NewHTTPError monta um erro geral com codigo HTTP (o navegador mostra o codigo ao tecnico).
func NewHTTPError(status int) PDU {
	return PDU{Version: Version1, Error: Err{Code: GeneralError, HTTPStatusCode: status}}
}

// NewTLSError monta um erro geral com o alerta TLS do servidor.
func NewTLSError(alert int) PDU {
	return PDU{Version: Version1, Error: Err{Code: GeneralError, TLSAlertCode: alert}}
}

// NewNegotiationError devolve a resposta X.224 de falha do servidor (por exemplo, "CredSSP obrigatorio").
func NewNegotiationError(x224 []byte) PDU {
	return PDU{Version: Version1, Error: Err{Code: NegotiationError}, X224ConnectionPDU: x224}
}
