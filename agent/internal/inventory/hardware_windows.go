//go:build windows

package inventory

import (
	"context"
	"sync"
	"sync/atomic"

	"github.com/yusufpapurcu/wmi"
)

// Classes do WMI consultadas. Os nomes dos campos sao as propriedades do WMI (PascalCase),
// que o servidor le como estao (secao 3.3 do contrato).

type win32ComputerSystem struct {
	Manufacturer, Model, Name, Domain, Workgroup, SystemType, UserName string
	PartOfDomain                                                       bool
	TotalPhysicalMemory                                                uint64
	NumberOfProcessors, NumberOfLogicalProcessors                      uint32
	PCSystemType                                                       uint16
}

type win32ComputerSystemProduct struct {
	Vendor, Name, IdentifyingNumber, UUID, Version string
}

type win32BIOS struct {
	Manufacturer, Name, SMBIOSBIOSVersion, SerialNumber, Version, ReleaseDate string
}

type win32BaseBoard struct {
	Manufacturer, Product, SerialNumber, Version string
}

type win32OperatingSystem struct {
	Caption, Version, BuildNumber, OSArchitecture, InstallDate, LastBootUpTime string
}

type win32Processor struct {
	Name, Manufacturer, DeviceID, SocketDesignation, ProcessorId string
	NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed      uint32
	AddressWidth                                                 uint16
}

type win32PhysicalMemory struct {
	Manufacturer, PartNumber, SerialNumber, BankLabel, DeviceLocator string
	Capacity                                                         uint64
	Speed                                                            uint32
}

type win32VideoController struct {
	Caption, Name, DriverVersion, VideoProcessor, VideoModeDescription string
	AdapterRAM, CurrentHorizontalResolution, CurrentVerticalResolution uint32
}

type win32DiskDrive struct {
	Caption, Model, InterfaceType, MediaType, SerialNumber, Status, DeviceID string
	Size                                                                     uint64
	Index, Partitions                                                        uint32
}

type win32NetworkAdapterConfiguration struct {
	Description, MACAddress, DHCPServer, DNSDomain              string
	Index                                                       uint32
	IPEnabled, DHCPEnabled                                      bool
	IPAddress, IPSubnet, DefaultIPGateway, DNSServerSearchOrder []string
}

// wmiQuery e uma secao do mapa wmi: dst aponta para a fatia de structs da classe.
type wmiQuery struct {
	section, class, where string
	dst                   any
}

func wmiQueries() []wmiQuery {
	return []wmiQuery{
		{"comp_sys", "Win32_ComputerSystem", "", &[]win32ComputerSystem{}},
		{"comp_sys_prod", "Win32_ComputerSystemProduct", "", &[]win32ComputerSystemProduct{}},
		{"bios", "Win32_BIOS", "", &[]win32BIOS{}},
		{"base_board", "Win32_BaseBoard", "", &[]win32BaseBoard{}},
		{"os", "Win32_OperatingSystem", "", &[]win32OperatingSystem{}},
		{"cpu", "Win32_Processor", "", &[]win32Processor{}},
		{"mem", "Win32_PhysicalMemory", "", &[]win32PhysicalMemory{}},
		{"graphics", "Win32_VideoController", "", &[]win32VideoController{}},
		{"disk", "Win32_DiskDrive", "", &[]win32DiskDrive{}},
		{"network_config", "Win32_NetworkAdapterConfiguration", "WHERE IPEnabled = TRUE", &[]win32NetworkAdapterConfiguration{}},
	}
}

// wmiBusy impede acumular coletas quando uma consulta anterior travou no WMI.
var wmiBusy atomic.Bool

// collectHardware consulta as classes do WMI em sequencia, numa goroutine propria, e devolve
// as secoes prontas ate o fim do prazo (uma classe que falha ou trava nao derruba as outras).
func collectHardware(ctx context.Context) map[string]any {
	if !wmiBusy.CompareAndSwap(false, true) {
		return nil
	}
	var mu sync.Mutex
	result := map[string]any{}
	done := make(chan struct{})
	go func() {
		defer func() {
			_ = recover()
			wmiBusy.Store(false)
			close(done)
		}()
		client := &wmi.Client{AllowMissingFields: true, NonePtrZero: true}
		for _, q := range wmiQueries() {
			if ctx.Err() != nil {
				return
			}
			if err := client.Query(wmi.CreateQuery(q.dst, q.where, q.class), q.dst); err != nil {
				continue
			}
			rows := structsToMaps(q.dst)
			mu.Lock()
			result[q.section] = rows
			mu.Unlock()
		}
	}()
	select {
	case <-done:
	case <-ctx.Done():
	}
	mu.Lock()
	defer mu.Unlock()
	out := make(map[string]any, len(result))
	for k, v := range result {
		out[k] = v
	}
	return out
}
