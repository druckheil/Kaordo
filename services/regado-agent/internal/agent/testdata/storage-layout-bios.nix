# Generated role allocation; Storage membership is managed by btrfs-progs
{
  disko.devices.disk.device = {
    type = "disk";
    device = "/dev/sdc";
    content = {
      type = "gpt";
      partitions = {
        boot = { size = "2M"; type = "EF02"; label = "kaordo-boot"; priority = 100; uuid = "00bd7456-240c-57b7-9ab7-f05e6ac41c4b"; };
        system = {
          size = "1024M"; type = "8300"; label = "kaordo-system"; priority = 200; uuid = "02272746-730e-5859-a0e3-048ec3c83598";
          content = { type = "filesystem"; format = "ext4"; extraArgs = [ "-L" "KaordoSystem" ]; mountpoint = "/"; };
        };
        storage = { size = "2048M"; type = "8300"; label = "kaordo-storage"; priority = 300; uuid = "c7f79cca-0298-52d1-b639-71ae24e75232"; };
      };
    };
  };
}
